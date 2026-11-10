import fs from "node:fs";
import path from "node:path";
import solc from "solc";
for (const contractName of ["HammyRewards", "HamsStakingPool"]) {
  const input = {
    language: "Solidity",
    sources: {
      [`${contractName}.sol`]: {
        content: fs.readFileSync(`contracts/${contractName}.sol`, "utf8"),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (p) => ({
        contents: fs.readFileSync(path.join("node_modules", p), "utf8"),
      }),
    }),
  );
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = output.contracts[`${contractName}.sol`][contractName];
  fs.mkdirSync("src/generated", { recursive: true });
  fs.writeFileSync(
    `src/generated/${contractName}.json`,
    JSON.stringify({
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      runtime: "0x" + c.evm.deployedBytecode.object,
    }),
  );
  console.log(
    `Compiled ${contractName}: ` +
      c.evm.bytecode.object.length / 2 +
      " deployment bytes",
  );
}
