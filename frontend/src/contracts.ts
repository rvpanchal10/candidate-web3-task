export const mockUsdAbi = [
  "function faucet() external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

export const vaultAbi = [
  "function createTransfer(address recipient,address token,uint256 amount,bytes32 secretHash,uint64 deadline) external returns (uint256)",
  "function claimTransfer(uint256 transferId,string secret) external",
  "function refundTransfer(uint256 transferId) external",
  "function transfers(uint256 transferId) external view returns (address sender,address recipient,address token,uint256 amount,bytes32 secretHash,uint64 deadline,uint8 status)"
];

export const defaultDeployment = {
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000000",
  vaultAddress: "0x0000000000000000000000000000000000000000"
};
