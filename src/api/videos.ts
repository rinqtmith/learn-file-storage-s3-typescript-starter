import { respondWithJSON } from "./json";

import { S3Client, type BunRequest } from "bun";
import { randomBytes } from "crypto";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";

const MAX_UPLOAD_SIZE = 1 << 30;
export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const metadata = getVideo(cfg.db, videoId);

  if (!metadata || metadata.userID !== userID) {
    throw new UserForbiddenError(
      "You do not have permission to upload a thumbnail for this video",
    );
  }

  const formData = await req.formData();
  const video = formData.get("video");
  if (!(video instanceof File)) {
    throw new BadRequestError("Invalid thumbnail file");
  }

  if (video.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large");
  }

  const type = video.type;

  if (type !== "video/mp4") {
    throw new BadRequestError("Unsupported video file type");
  }

  const key = `${randomBytes(32).toString("base64url")}.${type.split("/")[1]}`;
  const dataPath = path.join(cfg.assetsRoot, key);

  Bun.write(dataPath, video);

  S3Client.file(key).write(Bun.file(dataPath));

  Bun.file(dataPath).delete();

  metadata.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;

  updateVideo(cfg.db, metadata);

  return respondWithJSON(200, null);
}
