import { richSegments } from "@/features/help/rich-text";

/** Help copy with its **UI labels** set in bold. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {richSegments(text).map((segment, index) =>
        segment.bold ? <strong key={index}>{segment.text}</strong> : segment.text,
      )}
    </>
  );
}
