import { expect } from "chai";
import { ethers } from "hardhat";

const secret = "correct horse battery staple";
const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));

async function deployFixture() {
  const [owner, sender, recipient, stranger] = await ethers.getSigners();

  const MockUSD = await ethers.getContractFactory("MockUSD");
  const token = await MockUSD.deploy();
  await token.waitForDeployment();

  const SecureTransferVault = await ethers.getContractFactory("SecureTransferVault");
  const vault = await SecureTransferVault.deploy();
  await vault.waitForDeployment();

  const amount = ethers.parseEther("50");
  await token.transfer(sender.address, ethers.parseEther("500"));
  await token.connect(sender).approve(await vault.getAddress(), amount);

  return { owner, sender, recipient, stranger, token, vault, amount };
}

async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function latestTimestamp(): Promise<number> {
  return (await ethers.provider.getBlock("latest"))!.timestamp;
}

describe("SecureTransferVault", () => {
  it("creates a protected transfer and moves tokens into the vault", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await expect(vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline))
      .to.emit(vault, "TransferCreated")
      .withArgs(1, sender.address, recipient.address, await token.getAddress(), amount, secretHash, deadline);

    expect(await token.balanceOf(await vault.getAddress())).to.equal(amount);
    expect(await vault.nextTransferId()).to.equal(2);
  });

  it("increments transfer IDs for successive transfers", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);
    const tokenAddress = await token.getAddress();
    const vaultAddress = await vault.getAddress();

    await token.connect(sender).approve(vaultAddress, amount * 2n);

    await vault.connect(sender).createTransfer(recipient.address, tokenAddress, amount, secretHash, deadline);
    await vault.connect(sender).createTransfer(recipient.address, tokenAddress, amount, secretHash, deadline);

    expect(await vault.nextTransferId()).to.equal(3);
  });

  it("allows the recipient to claim with the right secret", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await expect(vault.connect(recipient).claimTransfer(1, secret))
      .to.emit(vault, "TransferClaimed")
      .withArgs(1, recipient.address, secretHash);

    expect(await token.balanceOf(recipient.address)).to.equal(amount);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
  });

  it("rejects claims with the wrong secret", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await expect(vault.connect(recipient).claimTransfer(1, "wrong secret")).to.be.revertedWithCustomError(
      vault,
      "InvalidSecret"
    );
  });

  it("rejects a claim by a stranger", async () => {
    const { sender, recipient, token, vault, amount, stranger } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await expect(vault.connect(stranger).claimTransfer(1, secret)).to.be.revertedWithCustomError(vault, "NotRecipient");
  });

  it("rejects a second claim after the transfer is already claimed", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);
    await vault.connect(recipient).claimTransfer(1, secret);

    await expect(vault.connect(recipient).claimTransfer(1, secret)).to.be.revertedWithCustomError(
      vault,
      "TransferAlreadyFinalised"
    );
  });

  it("rejects a claim after the deadline has passed", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 10);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await increaseTime(11);

    await expect(vault.connect(recipient).claimTransfer(1, secret)).to.be.revertedWithCustomError(vault, "TransferExpired");
  });

  it("rejects a claim on a non-existent transfer ID", async () => {
    const { vault } = await deployFixture();

    await expect(vault.claimTransfer(999, secret)).to.be.revertedWithCustomError(vault, "TransferNotFound");
  });

  it("allows sender refund after expiry and returns full balance", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 10);

    const senderBalanceBefore = await token.balanceOf(sender.address);
    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await expect(vault.connect(sender).refundTransfer(1)).to.emit(vault, "TransferRefunded").withArgs(1, sender.address);
    expect(await token.balanceOf(sender.address)).to.equal(senderBalanceBefore);
  });

  it("rejects refund before expiry", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);

    await expect(vault.connect(sender).refundTransfer(1)).to.be.revertedWithCustomError(vault, "TransferNotExpired");
  });

  it("rejects refund by a stranger", async () => {
    const { sender, recipient, token, vault, amount, stranger } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 10);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);
    await increaseTime(11);

    await expect(vault.connect(stranger).refundTransfer(1)).to.be.revertedWithCustomError(vault, "NotSender");
  });

  it("rejects a second refund after already refunded", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 10);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);
    await increaseTime(11);
    await vault.connect(sender).refundTransfer(1);

    await expect(vault.connect(sender).refundTransfer(1)).to.be.revertedWithCustomError(
      vault,
      "TransferAlreadyFinalised"
    );
  });

  it("rejects a refund on a non-existent transfer ID", async () => {
    const { vault } = await deployFixture();

    await expect(vault.refundTransfer(999)).to.be.revertedWithCustomError(vault, "TransferNotFound");
  });

  it("rejects refund of a claimed transfer", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, deadline);
    await vault.connect(recipient).claimTransfer(1, secret);

    await increaseTime(7200);

    await expect(vault.connect(sender).refundTransfer(1)).to.be.revertedWithCustomError(
      vault,
      "TransferAlreadyFinalised"
    );
  });

  it("rejects invalid recipient and zero amount", async () => {
    const { sender, recipient, token, vault } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await expect(vault.connect(sender).createTransfer(ethers.ZeroAddress, await token.getAddress(), 1, secretHash, deadline)).to.be.revertedWithCustomError(vault, "InvalidRecipient");
    await expect(vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), 0, secretHash, deadline)).to.be.revertedWithCustomError(vault, "InvalidAmount");
  });

  it("rejects sender as their own recipient", async () => {
    const { sender, token, vault } = await deployFixture();
    const deadline = BigInt((await latestTimestamp()) + 3600);

    await expect(vault.connect(sender).createTransfer(sender.address, await token.getAddress(), 1, secretHash, deadline)).to.be.revertedWithCustomError(vault, "InvalidRecipient");
  });

  it("rejects deadline equal to current timestamp", async () => {
    const { sender, recipient, token, vault, amount } = await deployFixture();

    await increaseTime(0);
    const now = BigInt(await latestTimestamp());

    await expect(vault.connect(sender).createTransfer(recipient.address, await token.getAddress(), amount, secretHash, now)).to.be.revertedWithCustomError(vault, "InvalidDeadline");
  });
});
