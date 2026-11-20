const { ethers } = require("ethers");

const RPC_URL = "http://127.0.0.1:8545";

async function checkNode() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  try {
    const [network, blockNumber, accounts] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.listAccounts(),
    ]);

    const firstAccount = accounts.length > 0 ? accounts[0].address : "None available";

    console.log("FairTicket Hardhat Node Check: OK");
    console.log(`RPC URL:       ${RPC_URL}`);
    console.log(`Chain ID:      ${network.chainId.toString()}`);
    console.log(`Latest Block:  ${blockNumber}`);
    console.log(`First Account: ${firstAccount}`);
  } catch (error) {
    console.error("FairTicket Hardhat Node Check: FAILED");
    console.error(`Could not connect to local Hardhat node at ${RPC_URL}.`);
    console.error('Make sure the node is running first by executing "npm run node" inside /blockchain.');
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }
}

checkNode();
