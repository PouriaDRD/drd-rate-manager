export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class AdminApi {
  constructor(basePath) {
    this.basePath = String(basePath || "").replace(/\/$/, "");
  }

  session() {
    return this.#request("/api/v1/auth/session");
  }

  login(username, password) {
    return this.#request("/api/v1/auth/login", {
      method: "POST",
      body: { username, password },
    });
  }

  bootstrap(payload, csrfToken) {
    return this.#request("/api/v1/bootstrap", { method: "POST", body: payload, csrfToken });
  }

  logout(csrfToken) {
    return this.#request("/api/v1/auth/logout", { method: "POST", csrfToken });
  }

  dashboard() {
    return this.#request("/api/v1/dashboard");
  }

  market() {
    return this.#request("/api/v1/market");
  }

  refreshMarket(csrfToken) {
    return this.#request("/api/v1/market/refresh", { method: "POST", csrfToken });
  }

  marketPreview() {
    return this.#request("/api/v1/market/preview");
  }

  publishMarket(csrfToken) {
    return this.#request("/api/v1/market/publish", { method: "POST", csrfToken });
  }

  preferences() {
    return this.#request("/api/v1/preferences");
  }

  updatePreferences(payload, csrfToken) {
    return this.#request("/api/v1/preferences", {
      method: "PATCH",
      body: payload,
      csrfToken,
    });
  }

  sources() {
    return this.#request("/api/v1/sources");
  }

  updateSource(source, enabled, csrfToken) {
    return this.#request(`/api/v1/sources/${encodeURIComponent(source)}`, {
      method: "PATCH",
      body: { enabled },
      csrfToken,
    });
  }

  testSource(source, csrfToken) {
    return this.#request(`/api/v1/sources/${encodeURIComponent(source)}/test`, {
      method: "POST",
      csrfToken,
    });
  }

  updateUsdtPriority(priority, csrfToken) {
    return this.#request("/api/v1/sources/usdt-priority", {
      method: "PATCH",
      body: { priority },
      csrfToken,
    });
  }

  assets() {
    return this.#request("/api/v1/assets");
  }

  refreshAssets(csrfToken) {
    return this.#request("/api/v1/assets/refresh", { method: "POST", csrfToken });
  }

  updateAsset(id, enabled, csrfToken) {
    return this.#request(`/api/v1/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { enabled },
      csrfToken,
    });
  }

  async #request(path, { method = "GET", body = null, csrfToken = "" } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== null) headers["Content-Type"] = "application/json";
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

    let response;
    try {
      response = await fetch(`${this.basePath}${path}`, {
        method,
        credentials: "same-origin",
        headers,
        ...(body !== null ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError("Network request failed.", 0, null);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new ApiError(payload?.message || `Request failed (${response.status})`, response.status, payload);
    }
    return payload || {};
  }
}
