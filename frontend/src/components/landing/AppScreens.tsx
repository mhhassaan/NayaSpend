import { screenContent, type ScreenName } from "./ScreenContent";

export function AppScreens({ names, active }: { names: readonly ScreenName[]; active: number }) {
  return <div className="screens" role="img" aria-label={`NayaSpend ${names[active]} preview`}>
    {names.map((name, i) => {
      const Content = screenContent[name];
      return <div key={name} className={`scr${i === active ? " on" : ""}`} data-screen={name} aria-hidden={i !== active}><Content /></div>;
    })}
  </div>;
}
