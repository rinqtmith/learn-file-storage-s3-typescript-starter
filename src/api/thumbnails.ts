import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();

export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  const thumbnail = videoThumbnails.get(videoId);
  if (!thumbnail) {
    throw new NotFoundError("Thumbnail not found");
  }

  return new Response(thumbnail.data, {
    headers: {
      "Content-Type": thumbnail.mediaType,
      "Cache-Control": "no-store",
    },
  });
}

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

  const metadata = getVideo(cfg.db, videoId);

  if (!metadata || metadata.userID !== userID) {
    throw new UserForbiddenError(
      "You do not have permission to upload a thumbnail for this video",
    );
  }

  videoThumbnails.set(videoId, {
    data: imageData,
    mediaType: type,
  });

  const thumbnailUrl = `http://localhost:8091/api/thumbnails/${videoId}`;

  metadata.thumbnailURL = thumbnailUrl;

  updateVideo(cfg.db, metadata);

  return respondWithJSON(200, metadata);
}
