/**
 * Deploys FairTicket and grants the demo roles.
 *   npx hardhat run scripts/deploy.js --network localhost
 * Role holders default to Hardhat accounts #1 (verifier), #2 (organizer), #3 (gate).
 * Writes deployments/localhost.json and the ABI for the backend.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [deployer, verifier, organizer, gate] = await ethers.getSigners();

  const verifierAddr = process.env.VERIFIER_ADDRESS || verifier.address;
  const organizerAddr = process.env.ORGANIZER_ADDRESS || organizer.address;
  const gateAddr = process.env.GATE_ADDRESS || gate.address;

  const FairTicket = await ethers.getContractFactory("FairTicket");
  const contract = await FairTicket.deploy(deployer.address);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  await (await contract.grantRole(await contract.VERIFIER_ROLE(), verifierAddr)).wait();
  await (await contract.grantRole(await contract.ORGANIZER_ROLE(), organizerAddr)).wait();
  await (await contract.grantRole(await contract.GATE_ROLE(), gateAddr)).wait();

  const network = await ethers.provider.getNetwork();
  const info = {
    contract: "FairTicket",
    address,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    verifier: verifierAddr,
    organizer: organizerAddr,
    gate: gateAddr,
    deployedAt: new Date().toISOString(),
  };

  const deployDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(path.join(deployDir, "localhost.json"), JSON.stringify(info, null, 2));

  const artifact = await hre.artifacts.readArtifact("FairTicket");
  const abiDir = path.join(__dirname, "..", "..", "backend", "src", "contracts");
  fs.mkdirSync(abiDir, { recursive: true });
  fs.writeFileSync(path.join(abiDir, "FairTicket.abi.json"), JSON.stringify(artifact.abi, null, 2));

  console.log("FairTicket deployed:", address);
  console.log("Put this in backend/.env and frontend/.env:");
  console.log(`  FAIRTICKET_CONTRACT_ADDRESS=${address}`);
  console.log(`  VITE_FAIRTICKET_CONTRACT_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
