const forwardedArguments = process.argv
  .slice(2)
  .filter((argument: string) => argument !== "--")
  .map((argument: string) =>
    argument.startsWith("--image-mode=")
      ? `--mode=${argument.slice("--image-mode=".length)}`
      : argument,
  );

process.argv.splice(
  2,
  process.argv.length - 2,
  ...forwardedArguments,
);

await import("./optimize-build-images.js");
