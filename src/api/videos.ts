import { respondWithJSON } from "./json";

import { S3Client, type BunRequest } from "bun";
import { randomBytes } from "crypto";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo } from "../db/videos";
import { BadRequestError, UserForbiddenError } from "./errors";

async function getVideoAspectRatio(filePath: string) {
  const ffprobeProcess = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    filePath,
  ]);

  const output = await new Response(ffprobeProcess.stdout).json();

  const exitCode = await ffprobeProcess.exited;
  if (exitCode !== 0) {
    const errorOutput = await new Response(ffprobeProcess.stderr).text();
    throw new Error(
      `ffprobe failed with exit code ${exitCode}: ${errorOutput}`,
    );
  }

  const videoStream = output.streams.find(
    (stream: any) => stream.codec_type === "video",
  );

  if (!videoStream) {
    throw new Error("No video stream found in the file");
  }

  const width = videoStream.width;
  const height = videoStream.height;

  const aspectRatio = Number((width / height).toFixed(2));
  if (aspectRatio === Number((16 / 9).toFixed(2))) {
    return "landscape";
  }
  if (aspectRatio === Number((9 / 16).toFixed(2))) {
    return "portrait";
  }
  return "other";
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = `${inputFilePath}.processed.mp4`;

  const ffmpegProcess = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
    { stderr: "pipe" },
  );

  const errorText = await new Response(ffmpegProcess.stderr).text();
  const exitCode = await ffmpegProcess.exited;

  if (exitCode !== 0) {
    throw new Error(`FFmpeg error: ${errorText}`);
  }

  return outputFilePath;
}

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

  const aspectRatio = await getVideoAspectRatio(dataPath);
  const processedVideoPath = await processVideoForFastStart(dataPath);
  const fullKey = `${aspectRatio}/${key}`;

  S3Client.file(fullKey).write(Bun.file(processedVideoPath));

  Bun.file(dataPath).delete();

  metadata.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fullKey}`;

  updateVideo(cfg.db, metadata);

  return respondWithJSON(200, null);
}
