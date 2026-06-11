import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const MockUSD = await ethers.getContractFactory("MockUSD");
  const token = await MockUSD.deploy();
  await token.waitForDeployment();

  const SecureTransferVault = await ethers.getContractFactory("SecureTransferVault");
  const vault = await SecureTransferVault.deploy();
  await vault.waitForDeployment();

  const deployment = {
    chainId: 31337,
    deployer: deployer.address,
    tokenAddress: await token.getAddress(),
    vaultAddress: await vault.getAddress()
  };

  const outputPath = path.resolve("..", "frontend", "src", "generated", "deployment.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log("Local deployment complete:");
  console.table(deployment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
