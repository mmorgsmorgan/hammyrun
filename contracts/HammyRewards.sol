// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Independent Sepolia game token. No relationship to SQK issuance.
/// The game operator publishes cumulative verified scores, never a player-supplied score.
contract HammyRewards is ERC20, Ownable2Step {
    uint256 public constant LOCK_SECONDS = 600;
    uint256 public constant TOKEN_PER_POINT = 1e16;
    uint256 public constant CAP = 10_000_000 ether;
    bytes32 public pointsRoot;
    uint256 public reservedRewards;
    uint256 public totalAcceptedPoints;
    mapping(address => uint256) public usedPoints;
    struct Position { uint256 points; uint64 unlockAt; bool claimed; }
    mapping(address => Position[]) public positions;
    event PointsPublished(bytes32 indexed root);
    event PointsStaked(address indexed player,uint256 indexed id,uint256 points,uint64 unlockAt);
    event RewardClaimed(address indexed player,uint256 indexed id,uint256 tokens);
    error SepoliaOnly(); error InvalidPoints(); error InvalidProof(); error NotMature(); error AlreadyClaimed(); error CapExceeded();
    constructor() ERC20("Hammy Run", "HAMS") Ownable(msg.sender) { if(block.chainid!=11155111) revert SepoliaOnly(); }
    function publishPoints(bytes32 root) external onlyOwner { if(root==bytes32(0))revert InvalidProof(); pointsRoot=root; emit PointsPublished(root); }
    function stakePoints(uint256 amount,uint256 cumulativePoints,bytes32[] calldata proof) external {
        if(amount==0||cumulativePoints<usedPoints[msg.sender]||amount>cumulativePoints-usedPoints[msg.sender])revert InvalidPoints();
        bytes32 leaf=keccak256(bytes.concat(keccak256(abi.encode(msg.sender,cumulativePoints))));
        if(!MerkleProof.verifyCalldata(proof,pointsRoot,leaf))revert InvalidProof();
        uint256 reward=amount*TOKEN_PER_POINT;
        if(totalSupply()+reservedRewards+reward>CAP)revert CapExceeded();
        usedPoints[msg.sender]+=amount; totalAcceptedPoints+=amount; reservedRewards+=reward;
        uint64 unlockAt=uint64(block.timestamp+LOCK_SECONDS);
        positions[msg.sender].push(Position(amount,unlockAt,false));
        emit PointsStaked(msg.sender,positions[msg.sender].length-1,amount,unlockAt);
    }
    function claim(uint256 id) external {
        Position storage p=positions[msg.sender][id];
        if(p.claimed)revert AlreadyClaimed(); if(block.timestamp<p.unlockAt)revert NotMature();
        p.claimed=true;uint256 reward=p.points*TOKEN_PER_POINT;reservedRewards-=reward;
        _mint(msg.sender,reward);emit RewardClaimed(msg.sender,id,reward);
    }
    function positionCount(address player) external view returns(uint256){return positions[player].length;}
}
