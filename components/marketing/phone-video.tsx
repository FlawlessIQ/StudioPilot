import { HelpVideoPlayer } from "@/components/help/video-player";
import { helpVideo } from "@/features/help/videos";

/**
 * A voiced how-to video recorded on a phone (couple-tour, crew-offer-accept…),
 * shown in a phone's outline: poster, captions, its own controls, never
 * autoplaying. Renders nothing where the video isn't published here, so the
 * page never shows an empty phone.
 */
export function PhoneVideo({ id, caption }: { id: string; caption?: string }) {
  if (!helpVideo(id)) return null;
  return (
    <figure className="mk-phone">
      <div className="mk-phone-body">
        <HelpVideoPlayer id={id} />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
