export type StopType = "city" | "region" | "brt" | "rail" | "ferry" | "outing";
export type RouteType = "city" | "region" | "brt" | "ferry" | "rail" | "trail";
export type Point = { x: number; y: number };
export type Stop = Point & { id: string; name: string; type: StopType };
export type Route = { id: string; a: string; b: string; length: number; type: RouteType; color: string; points?: Point[] };
export type MapData = { name: string; stops: Stop[]; routes: Route[] };

export const W = 1100;
export const H = 720;
export const STORAGE_KEY = "orebro-map-editor-v1";

export const stopTypeMeta: Record<StopType, { label: string; fill: string; stroke: string }> = {
  city: { label: "Stadshållplats", fill: "#fffaf0", stroke: "#721c24" },
  region: { label: "Länshållplats", fill: "#fff4dc", stroke: "#b05b2a" },
  brt: { label: "Citylinjen", fill: "#d9f2ef", stroke: "#00877c" },
  rail: { label: "Järnvägsstation", fill: "#e8e9eb", stroke: "#292b2f" },
  ferry: { label: "Färjehamn", fill: "#dceff8", stroke: "#23749b" },
  outing: { label: "Utflyktsmål", fill: "#e8f0dc", stroke: "#53723b" },
};

export const routeTypeMeta: Record<RouteType, { label: string; stroke: string; dash?: string }> = {
  city: { label: "Stadsbuss", stroke: "#721c24" },
  region: { label: "Länsbuss", stroke: "#b05b2a" },
  brt: { label: "Citylinjen", stroke: "#00877c" },
  ferry: { label: "Färja", stroke: "#23749b", dash: "10 7" },
  rail: { label: "Järnväg", stroke: "#292b2f", dash: "3 6" },
  trail: { label: "Bergslagsleden", stroke: "#53723b", dash: "11 6" },
};

export const routeColors: Record<string, string> = {
  neutral: "#f2ead8", red: "#cf3f3f", blue: "#3b72b9", green: "#4c8b58",
  yellow: "#e2b83b", black: "#3e4146", white: "#fffdf5", orange: "#da7a31", purple: "#8a5aa5",
};

export const colorLabels: Record<string, string> = {
  neutral: "Grå", red: "Röd", blue: "Blå", green: "Grön", yellow: "Gul",
  black: "Svart", white: "Vit", orange: "Orange", purple: "Lila",
};

const rawStops: Array<[string, string, number, number, StopType]> = [
  ["OSLO","Oslo",50,225,"region"],["KARLSKOGA","Karlskoga",160,252,"region"],["STORSTEN","Storstenshöjden",265,180,"outing"],
  ["ANNABODA","Ånnaboda",335,108,"outing"],["GARPH","Garphyttan",335,274,"outing"],["NORA","Nora",378,86,"region"],
  ["LIND","Lindesberg",530,50,"region"],["MELL","Mellringe",438,202,"city"],["VIV","Vivalla",530,144,"city"],
  ["SVAMP","Svampen",595,194,"outing"],["KARLSLUND","Karlslund",454,317,"outing"],["RC","Resecentrum",552,310,"rail"],
  ["JARN","Järntorget",632,266,"city"],["USO","USÖ",714,216,"city"],["KULTUR","Kulturkvarteret",638,331,"city"],
  ["WAD","Wadköping",724,302,"outing"],["VAG","Våghustorget",676,389,"city"],["OSTER","Österplan",772,382,"city"],
  ["OSET","Oset / Naturens hus",828,266,"outing"],["SKEBACK","Skebäck",905,310,"city"],["UNI","Universitetet",853,403,"brt"],
  ["BRICK","Brickebacken",929,432,"brt"],["HJALMBAD","Hjälmarbadet",982,360,"ferry"],["ARBOGA","Arboga",1030,259,"rail"],
  ["STOCKHOLM","Stockholm",1042,115,"rail"],["ODENS","Odensbacken",994,461,"region"],["HAMP","Hampetorp",950,547,"ferry"],
  ["VINON","Vinön",1042,569,"ferry"],["GUST","Gustavsvik / Södra tornet",606,446,"outing"],["LYRA","Lyran / Adolfsberg",595,490,"outing"],
  ["MARIE","Marieberg",487,526,"region"],["KUMLA","Kumla",595,562,"region"],["HALLSBERG","Hallsberg",681,648,"rail"],
  ["GOTEBORG","Göteborg",498,684,"rail"],
];

const routeRows: Array<[string,string,number,RouteType,string,Point[]?]> = [
  ["RC","JARN",1,"city","neutral"],["RC","KARLSLUND",2,"city","green"],["RC","GUST",2,"city","black"],["RC","SVAMP",2,"city","red"],
  ["JARN","KULTUR",1,"city","orange"],["JARN","WAD",2,"city","green"],["JARN","USO",2,"city","yellow"],["KULTUR","WAD",1,"city","neutral"],
  ["WAD","VAG",1,"city","red"],["WAD","OSTER",1,"city","neutral"],["WAD","OSET",2,"city","purple"],["VAG","GUST",2,"city","yellow"],
  ["USO","SVAMP",2,"city","purple"],["USO","OSET",2,"city","white"],["OSTER","OSET",2,"city","blue"],["GUST","LYRA",2,"city","orange"],
  ["GUST","MARIE",3,"city","white"],["LYRA","MARIE",2,"city","neutral"],["KARLSLUND","MELL",2,"city","neutral"],["SVAMP","VIV",2,"city","black"],
  ["OSET","SKEBACK",1,"city","neutral"],["OSTER","UNI",3,"city","orange"],["UNI","BRICK",3,"city","blue"],
  ["KARLSLUND","GARPH",3,"region","white"],["KARLSLUND","ANNABODA",4,"region","neutral"],["MARIE","GARPH",4,"region","purple"],
  ["LYRA","KUMLA",3,"region","blue"],["MARIE","KUMLA",3,"region","black"],["KUMLA","HALLSBERG",2,"region","purple"],["MARIE","HALLSBERG",4,"region","red"],
  ["VIV","NORA",4,"region","orange"],["MELL","NORA",4,"region","blue"],["SVAMP","LIND",5,"region","orange"],["NORA","LIND",3,"region","yellow"],
  ["GARPH","ANNABODA",2,"region","green"],["ANNABODA","STORSTEN",1,"region","neutral"],["GARPH","STORSTEN",2,"region","yellow"],
  ["GARPH","KARLSKOGA",4,"region","blue"],["STORSTEN","KARLSKOGA",4,"region","white"],["UNI","HJALMBAD",3,"region","black"],
  ["BRICK","HJALMBAD",3,"region","red"],["SKEBACK","HJALMBAD",3,"region","white"],["HJALMBAD","ODENS",3,"region","neutral"],
  ["USO","ODENS",5,"region","red",[{x:930,y:180},{x:1000,y:230},{x:1010,y:396}]],["ODENS","HAMP",4,"region","green"],
  ["ODENS","ARBOGA",5,"region","black"],["HAMP","ARBOGA",5,"region","neutral",[{x:1070,y:504},{x:1070,y:302}]],
  ["ARBOGA","STOCKHOLM",6,"region","green"],["HALLSBERG","GOTEBORG",6,"region","yellow"],["KARLSKOGA","OSLO",6,"region","purple"],
  ["HAMP","VINON",2,"ferry","neutral"],["SKEBACK","HAMP",4,"ferry","neutral",[{x:938,y:374},{x:938,y:418}]],
  ["RC","KULTUR",1,"brt","neutral"],["KULTUR","VAG",1,"brt","neutral"],["VAG","OSTER",2,"brt","neutral"],["OSTER","UNI",2,"brt","neutral"],
  ["UNI","BRICK",2,"brt","neutral"],["RC","VIV",3,"brt","neutral"],["RC","MELL",3,"brt","neutral"],
  ["RC","LIND",1,"rail","black"],["RC","ARBOGA",1,"rail","black"],["ARBOGA","STOCKHOLM",2,"rail","black"],
  ["RC","HALLSBERG",1,"rail","black"],["HALLSBERG","GOTEBORG",2,"rail","black"],["RC","KARLSKOGA",1,"rail","black"],["KARLSKOGA","OSLO",2,"rail","black"],
  ["ANNABODA","GARPH",1,"trail","green"],
];

export const initialMap: MapData = {
  name: "Örebro v0.2 – arbetskopia",
  stops: rawStops.map(([id,name,x,y,type]) => ({ id,name,x,y,type })),
  routes: routeRows.map(([a,b,length,type,color,points], i) => ({ id: `r${i+1}`,a,b,length,type,color,points })),
};
