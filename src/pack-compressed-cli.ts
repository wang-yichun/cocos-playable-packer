const forwardedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");

process.argv.splice(
  2,
  process.argv.length - 2,
  ...forwardedArguments,
);

await import("./pack-compressed.js");
