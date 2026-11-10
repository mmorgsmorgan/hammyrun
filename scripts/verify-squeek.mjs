import { client, verifyGraph, record } from "../server/chain.mjs";
const block = await verifyGraph((await client.getBlockNumber()) - 12n);
console.log(
  JSON.stringify({
    release: record.release,
    revision: record.revision,
    chainId: record.chainId,
    verifiedBlock: block.number.toString(),
    blockHash: block.hash,
  }),
);
