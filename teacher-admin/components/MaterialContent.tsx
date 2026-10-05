import {
  materialText,
  materialSegments,
  type MaterialRange,
} from '../../backend/src/material-text';
export default function MaterialContent({
  raw,
  annotations = [],
}: {
  raw: string;
  annotations?: MaterialRange[];
}) {
  const material = materialText(raw);
  return (
    <>
      {materialSegments(material.text, [...material.formatting, ...annotations]).map((part) => (
        <span
          key={part.start}
          className={part.styles.map((s) => 'material-' + s).join(' ')}
          style={{
            textDecorationLine:
              [
                part.styles.includes('underline') ? 'underline' : '',
                part.styles.includes('strike') ? 'line-through' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined,
          }}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}
