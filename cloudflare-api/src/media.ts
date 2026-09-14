import type { Hono } from "hono";
import type { PresignResponse } from "../../mobile/src/types/contract";
import { ApiProblem, currentUser, enumField, jsonObject, stringField } from "./helpers";
import { createUploadToken, verifyUploadToken } from "./security";
import { assertCanManageTeam, linkedPlayerIds, managingUser } from "./team-access";

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

/**
 * The shape of every key this API hands out: a squad's crest, filed under the
 * record it belongs to, named by a uuid. Nothing else in the bucket is served,
 * and nothing else may be written onto a team.
 *
 * Player photographs had a shape here, and an authorisation check to go with
 * it. AIMZ does not need them, so the feature is gone rather than guarded: the
 * safest photograph of a child is the one that was never stored. Any object
 * left in the bucket under `players/` is unreachable from here — this is the
 * only route that reads storage, and a key that does not match below is a 404
 * before the bucket is touched.
 */
export const MEDIA_KEY = {
  team: /^teams\/[A-Za-z0-9-]{1,64}\/[0-9a-f-]{36}\.(jpg|png|webp)$/u,
} as const;

/**
 * Removes a crest that nothing points at any more.
 *
 * Called when a squad's badge is replaced and when the squad itself is deleted.
 * Without it every replacement left the previous file in the bucket, readable
 * by its own address forever.
 *
 * Two safeguards, because deleting storage from a request handler is the kind
 * of thing that goes wrong quietly. The key must match the shape this API
 * mints, so a value that reached the column some other way cannot be turned
 * into a delete; and it must sit under the squad that owns it, so one squad
 * cannot be made to delete another's badge by being handed its key. Failure is
 * swallowed: a stranded object is untidy, a request that fails because tidying
 * failed is worse.
 */
export async function forgetMedia(env: Env, key: string | null, entityId: string): Promise<void> {
  if (!key || !MEDIA_KEY.team.test(key)) return;
  if (!key.startsWith(`teams/${entityId}/`)) return;
  try {
    await env.MEDIA.delete(key);
  } catch (error) {
    console.warn(JSON.stringify({ message: "media delete failed", error: error instanceof Error ? error.name : "unknown" }));
  }
}

export function maxUploadBytes(env: Env): number {
  const configured = Number(env.MEDIA_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

/**
 * Whether the file really is the image type it was declared as.
 *
 * The declared type is only what the client said. Checking the leading bytes
 * means a page or a script renamed to crest.png is refused at the door, rather
 * than stored and served back from the API's own origin.
 */
function matchesDeclaredType(head: Uint8Array, contentType: string): boolean {
  const startsWith = (bytes: number[], offset = 0) => bytes.every((byte, index) => head[offset + index] === byte);
  switch (contentType) {
    case "image/jpeg": return startsWith([0xff, 0xd8, 0xff]);
    case "image/png": return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // RIFF....WEBP
    case "image/webp": return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
    default: return false;
  }
}

export function registerMediaRoutes(app: App): void {
  app.post("/api/v1/media/uploads/presign", async (c) => {
    const { scope } = await managingUser(c);
    const body = await jsonObject(c);
    // Crests only. A player has no photograph to upload.
    const entity = enumField(body, "entity", ["team"] as const);
    const contentType = enumField(body, "content_type", MEDIA_TYPES);
    // The id becomes part of the object key, so it is held to the characters
    // an id is made of before it goes anywhere near a path.
    const entityId = stringField(body, "entity_id", { min: 1, max: 64 })!;
    if (!/^[A-Za-z0-9-]+$/u.test(entityId)) throw new ApiProblem(404, "entity_not_found", "Upload target not found.");
    const target = await c.env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(entityId).first<{ id: string }>();
    if (!target) throw new ApiProblem(404, "entity_not_found", "Upload target not found.");
    // A crest belongs to a squad, so the upload is held to the squads the
    // caller runs.
    assertCanManageTeam(scope, entityId);

    const objectKey = `${entity}s/${entityId}/${crypto.randomUUID()}.${ALLOWED_MEDIA_TYPES[contentType]}`;
    const token = await createUploadToken(objectKey, contentType, c.env.JWT_SECRET, UPLOAD_TOKEN_SECONDS);
    // Shaped like an S3 presigned POST so the app's existing upload code — build
    // a FormData from `fields`, append `file`, POST to `upload_url` — is unchanged.
    return c.json({
      upload_url: new URL("/api/v1/media/uploads", c.req.url).toString(),
      fields: { token, "Content-Type": contentType },
      object_key: objectKey,
      expires_in: UPLOAD_TOKEN_SECONDS,
    } satisfies PresignResponse);
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
    const limit = maxUploadBytes(c.env);
    if (file.size === 0) throw new ApiProblem(422, "invalid_upload", "The image was empty.");
    if (file.size > limit) throw new ApiProblem(422, "file_too_large", `Images must be ${Math.floor(limit / 1_048_576)}MB or smaller.`);
    if (!MEDIA_KEY.team.test(payload.key)) {
      throw new ApiProblem(403, "upload_not_authorized", "This upload link is invalid or has expired.");
    }
    if (!matchesDeclaredType(new Uint8Array(await file.slice(0, 16).arrayBuffer()), payload.content_type)) {
      throw new ApiProblem(422, "invalid_image", "Choose a JPEG, PNG, or WebP image.");
    }

    await c.env.MEDIA.put(payload.key, file.stream(), {
      httpMetadata: { contentType: payload.content_type, cacheControl: "public, max-age=31536000, immutable" },
    });
    return c.body(null, 204);
  });

  app.get("/api/v1/media/*", async (c) => {
    let key: string;
    try {
      key = decodeURIComponent(new URL(c.req.url).pathname.slice(MEDIA_PREFIX.length));
    } catch {
      throw new ApiProblem(404, "media_not_found", "Image not found.");
    }
    // Only a crest, and only a key of the exact shape this API mints. Anything
    // else — including a `players/` object left in the bucket from before
    // photographs were removed — is a 404 without storage being touched.
    const object = MEDIA_KEY.team.test(key) ? await c.env.MEDIA.get(key) : null;
    if (!object) throw new ApiProblem(404, "media_not_found", "Image not found.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Every key carries a uuid, so a crest never changes under the same URL.
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("content-disposition", "inline");
    return new Response(object.body, { headers });
  });
}
