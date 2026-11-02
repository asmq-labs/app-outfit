import * as Location from 'expo-location';
import * as React from 'react';

export type Coords = { lat: number; lon: number };

const LOCATION_TIMEOUT_MS = 5000;

async function readCoords(ask: boolean): Promise<Coords | null> {
  const { granted } = ask
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (!granted) return null;

  // City-level precision is enough for weather, so a recent known position is fine.
  const position =
    (await Location.getLastKnownPositionAsync()) ??
    (await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_TIMEOUT_MS)),
    ]));
  return position ? { lat: position.coords.latitude, lon: position.coords.longitude } : null;
}

// undefined while still asking, null when the location is not available.
// Only Hoy may ask, and only once there is an outfit whose weather matters.
export function useCoords(ask = false, wait = false): Coords | null | undefined {
  const [read, setRead] = React.useState<{ ask: boolean; coords: Coords | null } | null>(null);

  React.useEffect(() => {
    if (wait) return;
    readCoords(ask)
      .catch(() => null)
      .then((coords) => setRead({ ask, coords }));
  }, [ask, wait]);

  // A reading taken before asking must not pass for the answer, even for one render.
  return read?.ask === ask ? read.coords : undefined;
}
