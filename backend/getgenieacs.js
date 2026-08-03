import fetch from "node-fetch";

const username = "Adminacs";
const password = "Admincms*";
const deviceId = "00259E-ET8546MCUS-45434F4DBB8A1F9B";
const url = `http://aksester.us:7557/devices/?query={"_id":"${deviceId}"}`;

try {
  const res = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP error! Status: ${res.status}`);
  }

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
} catch (err) {
  console.error("❌ Terjadi kesalahan:", err.message);
}
