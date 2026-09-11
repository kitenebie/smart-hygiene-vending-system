interface SwitchProps {
  on: boolean;
  onChange: (val: boolean) => void;
}

export default function Switch({ on, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch${on ? '' : ' off'}`}
      onClick={() => onChange(!on)}
    />
  );
}
