import { createOAuthKv } from "../oauth-kv.js";

describe("createOAuthKv (memory)", () => {
  it("stores, reads JSON, expires, and lists keys", async () => {
    const kv = await createOAuthKv();

    await kv.put("token:a", JSON.stringify({ access_token: "x" }));
    const read = await kv.get("token:a", "json");
    expect(read).toEqual({ access_token: "x" });

    await kv.put("token:b", "plain", { expirationTtl: 1 });
    expect(await kv.get("token:b")).toBe("plain");

    const listed = await kv.list({ prefix: "token:" });
    expect(listed.keys.map((k) => k.name).sort()).toEqual(["token:a", "token:b"]);

    await kv.delete("token:a");
    expect(await kv.get("token:a")).toBeNull();

    await kv.close?.();
  });
});
