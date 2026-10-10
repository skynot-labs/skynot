import { useEffect, useRef } from "preact/hooks";
import type { Avatar } from "../contracts";
import { drawAvatar } from "./avatar-renderer";

export function AvatarCanvas({
  avatar,
  name,
  large = false,
}: {
  avatar: Avatar;
  name: string;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAvatar(ref.current, avatar, true);
  }, [avatar]);
  return (
    <canvas
      ref={ref}
      width={large ? 156 : 48}
      height={large ? 204 : 56}
      class={large ? "avatar-large" : "avatar-small"}
      role="img"
      aria-label={`${name}'s avatar`}
    />
  );
}
