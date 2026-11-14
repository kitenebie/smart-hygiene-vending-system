export default function Switch({ on, onChange }) {
    return (<button type="button" role="switch" aria-checked={on} className={`switch${on ? '' : ' off'}`} onClick={() => onChange(!on)}/>);
}
