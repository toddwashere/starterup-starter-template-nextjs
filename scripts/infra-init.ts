const profiles = ["local", "gcp", "aws", "azure", "render", "vercel"];

console.log("\n=== Deploy Profile Setup ===\n");
console.log("Available profiles:");
profiles.forEach((profile) => {
  console.log(`  - ${profile}`);
});
console.log(
  "\nPhase 2 wizard not yet implemented — see infra/README.md for manual setup steps for now.\n"
);

process.exit(0);
