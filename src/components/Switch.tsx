interface SwitchProps {
  on: boolean;
  onChange: (val: boolean) => void;
}

export default function Switch({ on, onChange }: SwitchProps) {
  return (
    <div
      className={`switch${on ? '' : ' off'}`}
      onClick={() => onChange(!on)}
    />
  );
}
