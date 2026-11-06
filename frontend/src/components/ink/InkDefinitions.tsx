// One static filter shared by all three decorative scenes.
export function InkDefinitions() {
  return (
    <svg className="login-ink-definitions pointer-events-none" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
      <filter id="login-ink-roughen" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="17" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      </defs>
      </svg>
  );
}
