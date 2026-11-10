// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Stake existing HAMS to share an owner-funded HAMS reward stream.
/// No minting, no exit fee, and no lock on principal. Empty pools pause rewards.
contract HamsStakingPool is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 private constant PRECISION = 1e27;
    IERC20 public stakingToken;
    uint256 public totalStaked;
    uint256 public totalRewardsFunded;
    uint256 public totalRewardsPaid;
    uint256 public rewardBudget;
    uint256 public rewardDuration;
    uint256 public rewardElapsed;
    uint256 public lastAccruedAt;
    uint256 public rewardIndex;
    uint256 private indexRemainder;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) private paidIndex;
    mapping(address => uint256) private userRemainder;

    error InvalidAmount(); error InvalidDuration(); error InvalidToken();
    error NothingToClaim(); error Insolvent(); error SepoliaOnly();
    event Staked(address indexed account,uint256 amount);
    event Withdrawn(address indexed account,uint256 amount);
    event RewardPaid(address indexed account,uint256 amount);
    event RewardsFunded(uint256 amount,uint256 duration,uint256 streamBudget);

    constructor(address token_) Ownable(msg.sender) {
        if(block.chainid!=11155111)revert SepoliaOnly();
        if(token_==address(0)||token_.code.length==0)revert InvalidToken();
        stakingToken=IERC20(token_); lastAccruedAt=block.timestamp;
    }

    function _projectedElapsed() internal view returns(uint256) {
        if(totalStaked==0||rewardElapsed>=rewardDuration)return rewardElapsed;
        return rewardElapsed+Math.min(block.timestamp-lastAccruedAt,rewardDuration-rewardElapsed);
    }
    function _released(uint256 elapsed) internal view returns(uint256) {
        return rewardDuration==0?0:Math.mulDiv(rewardBudget,elapsed,rewardDuration);
    }
    function remainingRewards() public view returns(uint256) {return rewardBudget-_released(_projectedElapsed());}
    function remainingSeconds() public view returns(uint256) {return rewardDuration-_projectedElapsed();}
    function projectedIndex() public view returns(uint256) {
        uint256 released=_released(_projectedElapsed())-_released(rewardElapsed);
        if(totalStaked==0||released==0)return rewardIndex;
        return rewardIndex+(released*PRECISION+indexRemainder)/totalStaked;
    }
    function earned(address account) public view returns(uint256) {
        return rewards[account]+(balanceOf[account]*(projectedIndex()-paidIndex[account])+userRemainder[account])/PRECISION;
    }
    function _accrue() internal {
        uint256 elapsed=_projectedElapsed();
        uint256 released=_released(elapsed)-_released(rewardElapsed);
        if(released>0&&totalStaked>0){
            uint256 scaled=released*PRECISION+indexRemainder;
            rewardIndex+=scaled/totalStaked;indexRemainder=scaled%totalStaked;
        }
        rewardElapsed=elapsed;lastAccruedAt=block.timestamp;
    }
    function _settle(address account) internal {
        _accrue();
        uint256 scaled=balanceOf[account]*(rewardIndex-paidIndex[account])+userRemainder[account];
        rewards[account]+=scaled/PRECISION;userRemainder[account]=scaled%PRECISION;
        paidIndex[account]=rewardIndex;
    }
    function _solvent() internal view {
        if(stakingToken.balanceOf(address(this))<totalStaked+totalRewardsFunded-totalRewardsPaid)revert Insolvent();
    }
    function stake(uint256 amount) external nonReentrant {
        if(amount==0)revert InvalidAmount();_settle(msg.sender);
        uint256 beforeBalance=stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender,address(this),amount);
        if(stakingToken.balanceOf(address(this))-beforeBalance!=amount)revert InvalidAmount();
        balanceOf[msg.sender]+=amount;totalStaked+=amount;_solvent();emit Staked(msg.sender,amount);
    }
    function withdraw(uint256 amount) external nonReentrant {
        if(amount==0||amount>balanceOf[msg.sender])revert InvalidAmount();_settle(msg.sender);
        balanceOf[msg.sender]-=amount;totalStaked-=amount;
        stakingToken.safeTransfer(msg.sender,amount);_solvent();emit Withdrawn(msg.sender,amount);
    }
    function claim() external nonReentrant returns(uint256 amount) {
        _settle(msg.sender);amount=rewards[msg.sender];if(amount==0)revert NothingToClaim();
        rewards[msg.sender]=0;totalRewardsPaid+=amount;
        stakingToken.safeTransfer(msg.sender,amount);_solvent();emit RewardPaid(msg.sender,amount);
    }
    function fundRewards(uint256 amount,uint256 duration) external onlyOwner nonReentrant {
        if(amount==0)revert InvalidAmount();if(duration<60||duration>30 days)revert InvalidDuration();
        _accrue();uint256 remaining=rewardBudget-_released(rewardElapsed);
        uint256 beforeBalance=stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender,address(this),amount);
        if(stakingToken.balanceOf(address(this))-beforeBalance!=amount)revert InvalidAmount();
        totalRewardsFunded+=amount;rewardBudget=remaining+amount;rewardDuration=duration;rewardElapsed=0;
        _solvent();emit RewardsFunded(amount,duration,rewardBudget);
    }
}
