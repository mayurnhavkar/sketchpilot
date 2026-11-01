// npm run aws:icons [-- --zip /path/to/Icon-package.zip]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installIcons } from "../server/aws-icons.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

installIcons({ outDir: path.join(root, "public", "aws-icons"), zip: arg("zip"), url: arg("url"), log: (m) => console.log(m) })
  .then(() => console.log("done: restart `npm run dev` if it is running"))
  .catch((e) => {
    console.error(`failed: ${e.message}`);
    process.exit(1);
  });
