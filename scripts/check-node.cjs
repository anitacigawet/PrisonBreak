function isSupportedNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}
module.exports = { isSupportedNode };
if (require.main === module && !isSupportedNode(process.versions.node)) {
  console.error(`Node.js 22.12 or newer is required; found ${process.versions.node}.`);
  process.exitCode = 1;
}
