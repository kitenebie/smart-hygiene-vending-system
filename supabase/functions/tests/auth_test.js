import assert from "node:assert/strict";

async function captureHandler(modulePath) {
  let handler;
  const serve = Deno.serve;
  Deno.serve = (callback) => {
    handler = callback;
  };
  try {
    await import(modulePath);
  } finally {
    Deno.serve = serve;
  }
  assert.equal(typeof handler, "function");
  return handler;
}

const login = await captureHandler("../admin-login/index.js");
const updateProfile = await captureHandler("../admin-profile-update/index.js");

const request = (method, body, headers = {}) =>
  new Request("http://edge.test", {
    method,
    headers: body === undefined
      ? headers
      : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const json = (body, status = 200) => Response.json(body, { status });

function mockFetch(routes, calls) {
  return async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    const call = {
      method: req.method,
      path,
      headers: req.headers,
      body: await req.clone().text(),
    };
    calls.push(call);
    const response = await routes(call);
    if (!response) {
      throw new Error(`Unexpected Supabase request: ${call.method} ${path}`);
    }
    return response;
  };
}

function setSupabaseEnv() {
  Deno.env.set("SUPABASE_URL", "http://supabase.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
}

Deno.test("admin Edge Functions validate requests and complete their Auth/profile flows", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = Deno.env.get("SUPABASE_URL");
  const originalKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const options = await login(request("OPTIONS"));
    assert.equal(options.status, 200);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");
    assert.equal((await login(request("GET"))).status, 405);

    let calls = [];
    globalThis.fetch = mockFetch(() => {
      throw new Error("Invalid input must not call Supabase.");
    }, calls);
    assert.equal(
      (await login(request("POST", { email: "bad-email", password: "x" })))
        .status,
      401,
    );
    assert.equal(calls.length, 0);
    assert.equal((await updateProfile(request("POST", {}))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal(
      (await updateProfile(
        request("POST", { email: "bad" }, {
          authorization: "Bearer test-user-token",
        }),
      )).status,
      400,
    );
    assert.equal(calls.length, 0);

    setSupabaseEnv();
    calls = [];
    globalThis.fetch = mockFetch((call) => {
      assert.equal(call.path, "/rest/v1/rpc/verify_legacy_admin_login");
      assert.equal(call.method, "POST");
      assert.equal(call.headers.get("apikey"), "test-service-role-key");
      const params = JSON.parse(call.body);
      assert.equal(params.p_email, "admin@example.com");
      assert.equal(params.p_password, "wrong-password");
      return json([]);
    }, calls);
    const invalidCredentials = await login(
      request("POST", {
        email: "ADMIN@example.com",
        password: "wrong-password",
      }),
    );
    assert.equal(invalidCredentials.status, 401);
    assert.equal(calls.length, 1);

    calls = [];
    globalThis.fetch = mockFetch((call) => {
      if (call.path === "/rest/v1/rpc/verify_legacy_admin_login") {
        assert.equal(call.headers.get("apikey"), "test-service-role-key");
        return json([{
          username: "admin",
          email: "admin@example.com",
          full_name: "Admin",
          phone: null,
          role: "Administrator",
        }]);
      }
      if (call.path === "/auth/v1/admin/users" && call.method === "GET") {
        return json({ users: [] });
      }
      if (call.path === "/auth/v1/admin/users" && call.method === "POST") {
        const body = JSON.parse(call.body);
        assert.equal(body.email, "admin@example.com");
        assert.notEqual(body.password, "legacy-password");
        return json({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: body.email,
          },
        });
      }
      if (call.path === "/rest/v1/profiles" && call.method === "POST") {
        return new Response(null, { status: 201 });
      }
      if (call.path === "/auth/v1/admin/generate_link") {
        return json({
          action_link: "https://supabase.test/verify",
          email_otp: "000000",
          hashed_token: "test-magic-link-hash",
          redirect_to: "",
          verification_type: "magiclink",
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "admin@example.com",
          },
        });
      }
      return null;
    }, calls);
    const loginResponse = await login(
      request("POST", {
        email: " ADMIN@example.com ",
        password: "legacy-password",
      }),
    );
    assert.equal(
      loginResponse.status,
      200,
      JSON.stringify(calls.map(({ method, path }) => `${method} ${path}`)),
    );
    assert.deepEqual(await loginResponse.json(), {
      token_hash: "test-magic-link-hash",
    });
    assert.equal(calls.length, 5);

    calls = [];
    globalThis.fetch = mockFetch((call) => {
      if (call.path === "/auth/v1/user") {
        return json({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "admin@example.com",
          },
        });
      }
      if (call.path === "/rest/v1/rpc/get_legacy_admin_profile") {
        return json([{ email: "admin@example.com" }]);
      }
      if (
        call.path ===
          "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111" &&
        call.method === "PUT"
      ) {
        const authUpdate = JSON.parse(call.body);
        assert.equal(authUpdate.email, "new-admin@example.com");
        assert.notEqual(authUpdate.password, "new-legacy-password");
        return json({ user: { id: "auth-admin-id", email: authUpdate.email } });
      }
      if (call.path === "/rest/v1/rpc/update_legacy_admin_profile") {
        const params = JSON.parse(call.body);
        assert.equal(params.p_previous_email, "admin@example.com");
        assert.equal(params.p_email, "new-admin@example.com");
        assert.equal(params.p_password, "new-legacy-password");
        return json([{
          email: "new-admin@example.com",
          username: "admin-new",
          full_name: "New Admin",
          phone: null,
          role: "Administrator",
        }]);
      }
      return null;
    }, calls);
    const profileResponse = await updateProfile(request("POST", {
      email: "new-admin@example.com",
      username: "admin-new",
      full_name: "New Admin",
      phone: "",
      password: "new-legacy-password",
    }, { authorization: "Bearer test-user-token" }));
    assert.equal(
      profileResponse.status,
      200,
      JSON.stringify(calls.map(({ method, path }) => `${method} ${path}`)),
    );
    assert.equal(
      (await profileResponse.json()).profile.email,
      "new-admin@example.com",
    );
    assert.equal(calls.length, 4);

    calls = [];
    globalThis.fetch = mockFetch((call) => {
      if (call.path === "/auth/v1/user") {
        return json({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "tech@example.com",
          },
        });
      }
      if (call.path === "/rest/v1/rpc/get_legacy_admin_profile") {
        return json([]);
      }
      return null;
    }, calls);
    const unauthorizedProfile = await updateProfile(request("POST", {
      email: "tech@example.com",
      username: "tech",
      full_name: "Technician",
      phone: "",
      password: "",
    }, { authorization: "Bearer test-technician-token" }));
    assert.equal(unauthorizedProfile.status, 403);
    assert.equal(calls.length, 2);

    calls = [];
    let authEmailWrites = 0;
    globalThis.fetch = mockFetch((call) => {
      if (call.path === "/auth/v1/user") {
        return json({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: "admin@example.com",
          },
        });
      }
      if (call.path === "/rest/v1/rpc/get_legacy_admin_profile") {
        return json([{ email: "admin@example.com" }]);
      }
      if (
        call.path ===
          "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111" &&
        call.method === "PUT"
      ) {
        const authUpdate = JSON.parse(call.body);
        authEmailWrites += 1;
        assert.equal(
          authUpdate.email,
          authEmailWrites === 1 ? "duplicate@example.com" : "admin@example.com",
        );
        return json({
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email: authUpdate.email,
          },
        });
      }
      if (call.path === "/rest/v1/rpc/update_legacy_admin_profile") {
        return json([]);
      }
      return null;
    }, calls);
    const failedProfile = await updateProfile(request("POST", {
      email: "duplicate@example.com",
      username: "admin-new",
      full_name: "Admin",
      phone: "",
      password: "",
    }, { authorization: "Bearer test-user-token" }));
    assert.equal(failedProfile.status, 400);
    assert.equal(
      authEmailWrites,
      2,
      "Auth email is restored if the admins-table update fails",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) Deno.env.delete("SUPABASE_URL");
    else Deno.env.set("SUPABASE_URL", originalUrl);
    if (originalKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", originalKey);
  }
});
