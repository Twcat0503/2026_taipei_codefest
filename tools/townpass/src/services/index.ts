import type { TownPassClient } from "../adapters/client.js";
import { CivicService } from "./civic.service.js";
import { LibraryService } from "./library.service.js";
import { PlacesService } from "./places.service.js";

export interface Services {
  baseUrl: string;
  library: LibraryService;
  civic: CivicService;
  places: PlacesService;
}

export function createServices(client: TownPassClient): Services {
  return {
    baseUrl: client.baseUrl,
    library: new LibraryService(client),
    civic: new CivicService(client),
    places: new PlacesService(client),
  };
}
