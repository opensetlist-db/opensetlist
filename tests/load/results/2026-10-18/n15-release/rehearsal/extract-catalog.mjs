import fs from "node:fs";
const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const html = fs.readFileSync(dir + "/page109.html", "utf8");
// The RSC payload lives in self.__next_f.push("...") strings where
// quotes are escaped as \" — look for one availableSongs entry at a time.
let idx = html.indexOf('availableSongs');
const re = /\\"songId\\":(\d+),(.*?)\\"festivalGroupIds\\":\[([\d,]*)\]/g;
const byGroup = {};
const seen = new Set();
let m;
while ((m = re.exec(html))) {
  const songId = m[1];
  if (seen.has(songId)) continue;
  seen.add(songId);
  const tm = /\\"originalTitle\\":\\"((?:[^"\\]|\\.)*?)\\"/.exec(m[2]);
  let title = tm ? tm[1] : "";
  title = title.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, "\\");
  const groups = m[3].split(",").filter(Boolean);
  for (const g of groups) (byGroup[g] ??= []).push({ songId, title });
}
for (const g of Object.keys(byGroup)) {
  console.log("group", g, "count", byGroup[g].length, JSON.stringify(byGroup[g].slice(0, 6)));
}
fs.writeFileSync(dir + "/catalog109.json", JSON.stringify(byGroup, null, 1));
console.log("availableSongs index:", idx, "total songs:", seen.size);
