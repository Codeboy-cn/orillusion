import { ParserBase } from "../ParserBase";
import { ParserFormat } from "../ParserFormat";

export enum GeoType {
    Point = "Point",
    LineString = "LineString",
    MultiPolygon = "MultiPolygon"
}

export interface GeoJsonGeometryStruct {
    type: GeoType;
    coordinates: any;
}

export interface GeoJsonPropertiesStruct {
    prop0: string;
    prop1: any;
}


export interface GeoJsonNodeStruct {
    type: string;
    geometry: GeoJsonGeometryStruct;
    properties: GeoJsonPropertiesStruct;
}

export interface GeoJsonStruct {
    type: string;
    features: GeoJsonNodeStruct[];
}

/**
 * Parser for GeoJSON feature collections. Parses the raw JSON text into
 * a typed {@link GeoJsonStruct} that downstream GIS utilities can consume.
 * @group Loader
 */
export class GeoJsonParser extends ParserBase {
    static format: ParserFormat = ParserFormat.JSON;
    /** Raw GeoJSON source text passed to the parser. */
    public json: string;
    /**
     * Parse GeoJSON text into a {@link GeoJsonStruct}.
     * @param data Raw GeoJSON string.
     */
    public async parseString(data: any) {
        this.json = data;
        this.data = JSON.parse(data) as GeoJsonStruct;
    }

    /**
     * Accept an already-parsed GeoJSON object. This is the entry point the
     * FileLoader JSON branch actually calls for {@link ParserFormat.JSON}
     * parsers (the base-class implementation was a no-op, so the parser
     * produced no data).
     * @param obj Parsed GeoJSON object.
     */
    public async parseJson(obj: object) {
        this.json = JSON.stringify(obj);
        this.data = obj as GeoJsonStruct;
    }
}