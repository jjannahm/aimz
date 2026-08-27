import type { Hono } from "hono";
import { ApiProblem, adminUser, enumField, jsonObject } from "./helpers";
import { createUploadToken, verifyUploadToken } from "./security";

type App = Hono<{ Bindings: Env }>;

/** Kept in step with the Python backend's ALLOWED_MEDIA_TYPES. */
const ALLOWED_MEDIA_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

const MEDIA_TYPES = Object.keys(ALLOWED_MEDIA_TYPES) as (keyof typeof ALLOWED_MEDIA_TYPES)[];
const UPLOAD_TOKEN_SECONDS = 900;
const DEFAULT_MAX_BYTES = 5_242_880;
const MEDIA_PREFIX = "/api/v1/media/";

function maxBytes(env: Env): number {
  const configured = Number(env.MEDIA_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

export function registerMediaRoutes(app: App): void {
  app.post("/api/v1/media/uploads/presign", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const entity = enumField(body, "entity", ["team", "player"] as const);
    const contentType = enumField(body, "content_type", MEDIA_TYPES);
    const entityId = String(body.entity_id ?? "");
    const table = entity === "team" ? "teams" : "players";
    const target = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(entityId).first<{ id: string }>();
    if (!target) throw new ApiProblem(404, "entity_not_found", "Upload target not found.");

    const objectKey = `${entity}s/${entityId}/${crypto.randomUUID()}.${ALLOWED_MEDIA_TYPES[contentType]}`;
    const token = await createUploadToken(objectKey, contentType, c.env.JWT_SECRET, UPLOAD_TOKEN_SECONDS);
    // Shaped like an S3 presigned POST so the app's existing upload code — build
    // a FormData from `fields`, append `file`, POST to `upload_url` — is unchanged.
    return c.json({
      upload_url: new URL("/api/v1/media/uploads", c.req.url).toString(),
      fields: { token, "Content-Type": contentType },
      object_key: objectKey,
      expires_in: UPLOAD_TOKEN_SECONDS,
    });
  });

  // Authorised by the signed token in the body rather than a bearer header: the
  // client posts this form straight at storage and never attaches its session.
  app.post("/api/v1/media/uploads", async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new ApiProblem(422, "invalid_upload", "Send the file as multipart form data.");
    }
    const token = form.get("token");
    const payload = typeof token === "string" ? await verifyUploadToken(token, c.env.JWT_SECRET) : null;
    if (!payload) throw new ApiProblem(403, "upload_not_authorized", "This upload link is invalid or has expired.");

    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiProblem(422, "invalid_upload", "Attach the image as the 'file' field.");
    const limit = maxBytes(c.env);
    if (file.size === 0) throw new ApiProblem(422, "invalid_upload", "The image was empty.");
    if (file.size > limit) throw new ApiProblem(422, "file_too_large", `Images must be ${Math.floor(limit / 1_048_576)}MB or smaller.`);

    await c.env.MEDIA.put(payload.key, file.stream(), {
      httpMetadata: { contentType: payload.content_type, cacheControl: "public, max-age=31536000, immutable" },
    });
    return c.body(null, 204);
  });

  app.get("/api/v1/media/*", async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.slice(MEDIA_PREFIX.length));
    const object = key ? await c.env.MEDIA.get(key) : null;
    if (!object) throw new ApiProblem(404, "media_not_found", "Image not found.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Every key carries a uuid, so an image never changes under the same URL.
    headers.set("cache-control", "public, max-age=31536000, immutable");
    return new Response(object.body, { headers });
  });
}
