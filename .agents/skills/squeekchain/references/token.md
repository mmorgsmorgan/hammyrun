> Documentation index: https://docs.squeekchain.com/llms.txt. Use it to find every page.

# SqueekToken

> SqueekToken ($SQK) function by function: ERC-20 and permit, the construction premint, the one-time Mining binding, burns, supply totals, events, errors and ABI.

Web version: https://docs.squeekchain.com/developers/token/

## TL;DR

- $SQK is a non-upgradeable ERC-20 with EIP-2612 permit and 18 decimals, capped at 2.1 billion $SQK of lifetime issuance including a construction premint.
- The [admin Timelock](admin.md) binds `SqueekMining` once with `bindMining`; after that only SqueekMining can mint, always to itself.
- Any holder can `burn` their own $SQK; burns lower circulating supply but never reopen the cap, because the cap limits `totalMinted()`.

## Overview

!!! warning "In active development"

    These contracts may change before mainnet. Pin the ABI you use and re-check the deployment before relying on it.

SqueekToken records $SQK balances, allowances and lifetime issuance. Its constructor mints a bounded premint and authorizes the admin Timelock to bind `SqueekMining` once. After binding, only that proxy can increase supply, through `mintForCheckpoint`; the token has no owner, pause, blocklist or upgrade path. The issuance schedule lives in [SqueekMining](mining.md#issuance-schedule).

The token is deployed directly, not behind a proxy; its Sepolia address is under [Deployments](overview.md#deployments).

## Functions

### Types

```solidity
struct PremintAllocation {
    address recipient;  // never zero or the token itself
    uint256 amount;     // positive, SQK base units
}
```

### Holder actions

#### Standard ERC-20 and EIP-2612

```solidity
function name() external view returns (string);                 // "Squeek"
function symbol() external view returns (string);               // "SQK"
function decimals() external view returns (uint8);              // 18
function totalSupply() external view returns (uint256);
function balanceOf(address account) external view returns (uint256);
function allowance(address owner, address spender) external view returns (uint256);
function transfer(address to, uint256 value) external returns (bool);
function approve(address spender, uint256 value) external returns (bool);
function transferFrom(address from, address to, uint256 value) external returns (bool);
function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
function nonces(address owner) external view returns (uint256);
function DOMAIN_SEPARATOR() external view returns (bytes32);
function eip712Domain() external view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions);
```

These are OpenZeppelin 5.6.1's [ERC20](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/token/ERC20/ERC20.sol), [ERC20Capped](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/token/ERC20/extensions/ERC20Capped.sol) and [ERC20Permit](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.6.1/contracts/token/ERC20/extensions/ERC20Permit.sol). Amounts are $SQK base units (`10^-18` $SQK); `totalSupply()` is circulating supply (minted minus burned). The permit domain is name `Squeek`, version `1`, this chain and this token. A permit sets an allowance only; SqueekStaking actions still require their normal caller authorization.

#### `burn`

```solidity
function burn(uint256 amount) external;
```

Destroys `amount` of the caller's own $SQK and adds it to `totalBurned()`; there's no `burnFrom`. SqueekStaking burns [exit fees](staking.md#exit-fee) this way from its own balance. Burning never restores issuance capacity. Reverts with `ERC20InsufficientBalance(sender, balance, needed)`.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `amount` | `uint256` | $SQK base units | Amount to destroy; `0` is allowed |

### Views

#### Totals and cap

```solidity
function cap() external view returns (uint256);
function totalPreminted() external view returns (uint256);
function totalBurned() external view returns (uint256);
function totalMinted() external view returns (uint256);
function MAX_PREMINT_RECIPIENTS() external view returns (uint256);
```

| Function | Returns |
|---|---|
| `cap()` | The lifetime cap on `totalMinted()`: `2,100,000,000 × 10^18` base units, fixed by the constructor |
| `totalPreminted()` | $SQK minted by the constructor premint; never changes |
| `totalBurned()` | Lifetime $SQK destroyed through `burn` |
| `totalMinted()` | Lifetime $SQK minted, premint included: `totalSupply() + totalBurned()` |
| `MAX_PREMINT_RECIPIENTS()` | `8`, the longest constructor premint list |

#### `mining`

```solidity
function mining() external view returns (address);
```

Zero before `bindMining`; afterwards the bound SqueekMining proxy, permanently the only minter and the only mint recipient.

#### `miningBindingAuthority`

```solidity
function miningBindingAuthority() external view returns (address);
```

The admin Timelock fixed at construction; its only privilege here is the one `bindMining` call.

### Admin and setup

#### `constructor`

```solidity
constructor(address bindingTimelock, uint256 supplyCap_, PremintAllocation[] memory premint);
```

Fixes the binding authority and cap (which must equal `2,100,000,000 × 10^18`), then mints each premint allocation in order. `bindingTimelock` must be a contract reporting a nonzero minimum delay and holding its own admin role. The premint accepts at most 8 entries. Recipients must be strictly increasing by address, nonzero and not the token itself; each amount must be positive, and the total must stay below the cap so SqueekMining has a nonzero allowance. Recipients and amounts are deployment inputs, not constants.

Reverts with `InvalidSupplyCap(supplied)`, `ERC20InvalidCap(cap)`, `InvalidMiningBindingAuthority`, `BindingCallFailed`, `InvalidPremintAllocation(index)` (`index` 8 means the list is too long), `ERC20ExceededCap(increasedSupply, cap)` or `NoMiningAllowance`.

#### `bindMining`

```solidity
function bindMining(address candidate) external;
```

Binding authority only, once. Atomically attaches the SqueekMining proxy:

1. Checks the authority is still a valid timelock and that `candidate` is a guarded issuance proxy whose implementation has code and whose ProxyAdmin is owned by the authority.
2. Checks the candidate's `bindings()` name this token and the authority as `governance` with a zero premint, and its `state()` is untouched: nothing minted, not started, not bootstrapped, not active.
3. Sets `mining`, calls the candidate's [`completeBootstrap()`](mining.md#completebootstrap), then re-reads it and requires `bootstrapped` with `premint == totalPreminted()`.
4. Emits `MiningBound`; the bound proxy may then call `mintForCheckpoint`.

Any failure rolls back both contracts. There's no rebinding.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `candidate` | `address` | — | The SqueekMining proxy |

Reverts with `UnauthorizedMiningBindingAuthority`, `MiningAlreadyBound`, `InvalidMining`, `InvalidMiningBindingAuthority`, `InvalidProxyRuntime`, `InvalidProxyAdmin`, `BindingCallFailed` or `MiningBootstrapFailed`.

### SqueekMining only

#### `mintForCheckpoint`

```solidity
function mintForCheckpoint(uint64 throughRound, uint256 amount) external returns (uint256);
```

Bound SqueekMining only. Mints `amount` to SqueekMining, emits `CheckpointMinted` with the lifetime total afterwards (even for zero, which mints nothing) and returns `amount`. SqueekMining forwards it all to SqueekStaking in the same transaction.

| Name | Type | Unit | Meaning |
|---|---|---|---|
| `throughRound` | `uint64` | SqueekCore round | SqueekMining's processed cursor after the checkpoint; attribution metadata only |
| `amount` | `uint256` | $SQK base units | Amount to mint |

Reverts with `UnauthorizedMining` before binding completes or for any other caller, and `ERC20ExceededCap(increasedSupply, cap)` when `totalMinted()` would pass the cap.

## Events

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);
event MiningBound(address indexed mining);
event CheckpointMinted(uint64 indexed throughRound, uint256 amount, uint256 totalMinted);
event EIP712DomainChanged();
```

| Event | Emitted when |
|---|---|
| `Transfer` | Any transfer; a premint or nonzero checkpoint mint is a `Transfer` from the zero address, and a burn a `Transfer` to it |
| `Approval` | `approve` or `permit`; spending an allowance with `transferFrom` emits none |
| `MiningBound` | `bindMining` completes |
| `CheckpointMinted` | Every checkpoint mint, including zero; `totalMinted` is lifetime issuance afterwards, premint and burns included |
| `EIP712DomainChanged` | Declared by the inherited interface; never emitted, since the domain is fixed |

## Errors

| Error | Cause | Fix |
|---|---|---|
| `UnauthorizedMining` | A mint before binding completes, or from any caller other than SqueekMining | Only the bound SqueekMining mints |
| `UnauthorizedMiningBindingAuthority` | `bindMining` from an address other than `miningBindingAuthority()` | Submit through the admin Timelock |
| `MiningAlreadyBound` | A second `bindMining` | Binding is permanent |
| `InvalidMining` | The candidate is not a fresh, matching guarded SqueekMining proxy | Deploy SqueekMining against this token and timelock |
| `MiningBootstrapFailed` | The candidate's `completeBootstrap()` reverted | Read the candidate's error; nothing changed |
| `InvalidMiningBindingAuthority` | The authority is not a contract, has a zero minimum delay, or does not administer itself | Setup only |
| `InvalidProxyRuntime`, `InvalidProxyAdmin`, `BindingCallFailed` | The candidate's proxy or ProxyAdmin runtime is unrecognized, or a binding read failed | Setup only |
| `InvalidSupplyCap(supplied)`, `ERC20InvalidCap(cap)` | The constructor cap is not 2.1 billion $SQK | Setup only |
| `InvalidPremintAllocation(index)`, `NoMiningAllowance` | A bad premint entry, too many entries, or a premint that leaves no allowance | Setup only |
| `ERC20ExceededCap(increasedSupply, cap)` | A mint would take `totalMinted()` past the cap | SqueekMining clips issuance at the cap |
| `ERC20InsufficientBalance(sender, balance, needed)` | Transfer or burn larger than the balance | Use a smaller amount |
| `ERC20InsufficientAllowance(spender, allowance, needed)` | `transferFrom` beyond the allowance | Approve or permit more |
| `ERC20InvalidSender(sender)`, `ERC20InvalidReceiver(receiver)`, `ERC20InvalidApprover(approver)`, `ERC20InvalidSpender(spender)` | A zero address where one is not allowed | Use a real address |
| `ERC2612ExpiredSignature(deadline)` | Permit after its deadline | Sign a new permit |
| `ERC2612InvalidSigner(signer, owner)`, `ECDSAInvalidSignature`, `ECDSAInvalidSignatureLength(length)`, `ECDSAInvalidSignatureS(s)` | Permit not signed by `owner` over these fields, or malformed | Sign with the owner's key for the current nonce |
| `InvalidAccountNonce(account, currentNonce)` | Permit nonce already used | Read `nonces(owner)` and sign again |
| `InvalidShortString`, `StringTooLong(str)` | Inherited EIP-712 name or version encoding failure | Setup only |

## Integrator patterns

- **Use base units.** Keep amounts as `bigint` base units and format with 18 decimals; never convert to `number`.
- **Measure issuance with `totalMinted()`.** Circulating supply is `totalSupply()`; the cap applies to lifetime issuance, `totalMinted() = totalSupply() + totalBurned()`. Remaining capacity is `cap() − totalMinted()`.
- **Reconcile with SqueekMining.** `totalMinted() == totalPreminted() + SqueekMining.state().minted`; SqueekMining checks this on every checkpoint.
- **Count supply once.** A checkpoint mint emits both `CheckpointMinted` and a `Transfer`; count one.
- **Check the binding.** Before relying on issuance, confirm `mining()` is nonzero and equals the SqueekMining proxy you verified.
- **Treat it as a plain ERC-20 otherwise.** There are no transfer hooks, fees, pauses or blocklists.

## Supply totals

Each way supply moves has its own total:

```text
totalMinted() = totalPreminted() + SqueekMining.state().minted
totalSupply() = totalMinted() − totalBurned()
totalMinted() ≤ cap() = 2,100,000,000 × 10^18
```

The premint happens once, in the constructor, before SqueekMining exists. Scheduled issuance is minted to SqueekMining, which funds SqueekStaking in the same transaction. Burns, including SqueekStaking's exit fees, move $SQK from circulating supply into `totalBurned()`, which still counts toward the cap.

## Usage example

Reads $SQK supply totals and checks them against each other and SqueekMining. Uses `setup.ts` and `verifyGraph()` from the [Quickstart](quickstart.md#verify-the-deployment), which takes the token from `SQK_ADDRESS` and verifies the SqueekMining proxy at `MINING_ADDRESS`.

```ts
// sqk-supply.ts
import { formatUnits, getAddress, parseAbi } from "viem";
import { blockNumber, client } from "./setup";
import { verifyGraph } from "./verify";

const { token, mining } = await verifyGraph();
const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function cap() view returns (uint256)",
  "function totalPreminted() view returns (uint256)",
  "function totalBurned() view returns (uint256)",
  "function totalMinted() view returns (uint256)",
  "function mining() view returns (address)",
]);
const miningAbi = parseAbi([
  "function state() view returns ((uint256 minted, uint64 processedThroughRound, uint64 startRound, uint64 startHeight, uint64 fundedBlocks, address guardian, bool bootstrapped, bool startCaptured, bool paused, bool active))",
]);
const read = { address: token, abi: tokenAbi, blockNumber } as const;
const [supply, cap, preminted, burned, minted, boundMining, state] = await Promise.all([
  client.readContract({ ...read, functionName: "totalSupply" }),
  client.readContract({ ...read, functionName: "cap" }),
  client.readContract({ ...read, functionName: "totalPreminted" }),
  client.readContract({ ...read, functionName: "totalBurned" }),
  client.readContract({ ...read, functionName: "totalMinted" }),
  client.readContract({ ...read, functionName: "mining" }),
  client.readContract({ address: mining, abi: miningAbi, functionName: "state", blockNumber }),
]);
if (getAddress(boundMining) !== mining) throw new Error("SqueekToken is not bound to this SqueekMining");
if (minted !== supply + burned) throw new Error("Lifetime issuance differs from supply plus burns");
if (minted !== preminted + state.minted) throw new Error("Issuance differs from premint plus SqueekMining");
console.log({
  liveSupplySQK: formatUnits(supply, 18),
  burnedSQK: formatUnits(burned, 18),
  remainingCapacitySQK: formatUnits(cap - minted, 18),
});
```

## ABI

[`SqueekToken.json`](https://docs.squeekchain.com/assets/abi/SqueekToken.json) matches the Sepolia deployment. Call it on the token address listed under [Deployments](overview.md#deployments); any ERC-20 ABI also works for transfers and balances.

## Related pages

- [SqueekMining](mining.md)
- [SqueekStaking](staking.md)
- [The $SQK token](https://docs.squeekchain.com/rewards/token.md)
- [Supply limits and rounding](https://docs.squeekchain.com/rewards/supply-and-rounding.md)
