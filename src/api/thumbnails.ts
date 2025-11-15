import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

const MAX_UPLOAD_SIZE = 10 << 20;
export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const image = formData.get("thumbnail");

  if (!(image instanceof File)) {
    throw new BadRequestError("Invalid thumbnail file");
  }

  if (image.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  const type = image.type;
  const imageData = await image.arrayBuffer();
  const imageBuffer = Buffer.from(imageData).toString("base64");
  const dataUrl = `data:${type};base64,${imageBuffer}`;

  const metadata = getVideo(cfg.db, videoId);

  if (!metadata || metadata.userID !== userID) {
    throw new UserForbiddenError(
      "You do not have permission to upload a thumbnail for this video",
    );
  }

  metadata.thumbnailURL = dataUrl;

  updateVideo(cfg.db, metadata);

  return respondWithJSON(200, metadata);
}
