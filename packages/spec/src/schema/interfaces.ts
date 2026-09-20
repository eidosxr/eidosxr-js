/**
 * Auto-generated TypeScript interfaces for EIDOS schemas
 * Generated from: https://schemas.oceanum.io/eidos/v0.12/root.json
 * 
 * Each interface corresponds to a definition in the EIDOS schema bundle.
 * These interfaces can be used for type validation and IDE support.
 * 
 * Do not modify this file directly - regenerate using:
 * npm run generate-types -w @eidosxr/spec
 */

const WorldNodeType = "world" as const;
const PlotNodeType = "plot" as const;
const DocumentNodeType = "document" as const;
const GridNodeType = "grid" as const;
const MenuNodeType = "menu" as const;
const PanelNodeType = "panel" as const;
const WorldlayerNodeType = "worldlayer" as const;
const ControlgroupNodeType = "controlgroup" as const;
const DerivedNodeType = "derived" as const;

/**
 * EIDOS specification
 * Complete specification for defining interactive oceanic and geospatial data visualizations using the EIDOS framework. An EIDOS specification is a declarative JSON document that describes the entire structure, layout, data sources, and interactions for a data visualization application. This top-level schema defines the root structure that contains metadata, data definitions, theming, and the hierarchical node structure that defines the user interface.
 */
export interface EidosSpec {
  /**
   * Version of EIDOS. Optional and informational only — not read at runtime, so specs authored against older or newer versions are still accepted (EID-102: dropped the '0.11' const, which hard-failed any spec that didn't set this exact string).
   */
  version?: string;
  /**
   * Unique identifier for this specification. Must be URL-safe using only lowercase letters, numbers, hyphens, and underscores. This ID is used for referencing the specification in URLs, file systems, and databases. It should be descriptive but concise.
   * 
   * @example
   * "seastate-demo"
   * "plot-demo"
   * "grid-layout-demo"
   */
  id: string;
  /**
   * Human-readable display name for this specification. This is the name shown to users in lists, menus, and interfaces. It can contain spaces, special characters, and mixed case. Should be descriptive and meaningful to end users. Must not be empty.
   * 
   * @example
   * "DemoOverlay"
   * "DemoPlot"
   * "DemoGrid"
   */
  name: string;
  /**
   * Detailed description of what this specification does and its purpose. This is primarily for documentation and metadata purposes - it's not typically displayed in the main interface but may be shown in tooltips, help text, or specification listings. Useful for developers and content creators.
   * 
   * @example
   * "Demonstration overlay"
   * "Demonstration grid layout"
   * "Demonstration document"
   */
  description?: string;
  /**
   * Title displayed in the header bar at the top of the screen. The header bar is shown only when a title or logo is set.
   */
  title?: string;
  /**
   * Logo image shown in the header bar, as an image URL (absolute or relative) or a data URI
   */
  logo?: string;
  theme?: EidosTheme;
  /**
   * Data Sources
   * Array of data source definitions that provide data to the visualization components. Each data source can be a static dataset, OceanQL query, Oceanum Datamesh source, or other supported data provider. Data sources are referenced by ID throughout the specification.
   * 
   * @example
   * [{"id":"sig-wave-height-trki","dataType":"oceanql","dataSpec":{"datasource":"oceanum_wave_trki_era5_v1_grid","variables":["hs","tps"],"geofilter":{"type":"feature","geom":{"type":"Feature","geometry":{"type":"Point","coordinates":[174.3,-38.5]}}},"timefilter":{"times":["2018-01-01 00:00:00Z","2019-01-01 00:00:00Z"]}}}]
   */
  data?: EidosData[];
  /**
   * Top-level node of the user interface. A content node (world, plot or document) fills the whole view; a layout node (grid or menu) arranges further child nodes. Set to null for a specification that defines no interface yet (e.g. an empty template). A derived node cannot be the root.
   */
  root?: World | Plot | Document | Grid | Menu | null;
  /**
   * Floating panels available to the whole specification. Each panel wraps a content node and is opened by a panelopen control, an event trigger, or a spec patch. Panel IDs must be unique; they are referenced by controls (config.panelId) and world layers (panel).
   */
  panels?: EidosPanel[];
}

/**
 * PlotSpec
 * Placeholder for Vega/Vega-Lite plot specifications
 */
export interface PlotSpec {
  /**
   * The Vega/Vega-Lite schema URL
   */
  $schema?: string;
  /**
   * The data specification
   */
  data?: object;
  /**
   * The mark type or definition
   */
  mark?: any;
  /**
   * The encoding specification
   */
  encoding?: object;
  /**
   * The configuration options
   */
  config?: object;
  [key: string]: any;
}

/**
 * Eidos theme
 * Visual theme of an EIDOS specification: a color-scheme preset plus optional style overrides grouped by category (color, text, control, panel, grid).
 */
export interface EidosTheme {
  /**
   * Color scheme for the view
   */
  preset?: "default" | "dark";
  /**
   * Style overrides applied on top of the preset.
   */
  style?: EidosStyle;
}

/**
 * EIDOS data
 * Data source specification for EIDOS visualizations. Defines how to access and process data from various sources including Oceanum Datamesh, Zarr arrays, inline datasets, GeoJSON features, and data transformations. Each data source has a unique ID that can be referenced by visualization components.
 */
export interface EidosData {
  /**
   * Unique identifier for this data source within the specification. Must be alphanumeric with hyphens and underscores only. This ID is used to reference the data source from visualization layers and components.
   * 
   * @example
   * "sig-wave-height-trki"
   * "ship-positions"
   * "weather-data"
   */
  id: string;
  /**
   * Type of data source that determines how the data is accessed and processed. Each type requires different configuration in the dataSpec property.
   * 
   * @example
   * "dataset"
   * "geojson"
   * "transform"
   */
  dataType: "oceanql" | "zarr" | "dataset" | "geojson" | "transform" | "pmtiles";
  /**
   * Configuration of the data source. The accepted form depends on dataType: 'dataset' takes an inline Dataset, 'transform' a Transform, 'geojson' a GeoJSON Feature or FeatureCollection, 'oceanql' a Datamesh OceanQL query, 'zarr' a Zarr group and 'pmtiles' a PMTiles archive.
   */
  dataSpec: Dataset | Transform | Geojson | Oceanquery | ZarrGroup | PmtilesArchive;
  /**
   * Optional human-readable name for this data source. Not required; accepted so that specs which annotate a data source with a name do not hard-fail under additionalProperties:false ($defs.dataset and $defs.transform already accept a name).
   */
  name?: string;
  /**
   * Optional human-readable description of this data source. Not required; accepted so that specs which annotate a data source with a description do not hard-fail under additionalProperties:false.
   */
  description?: string;
}

/**
 * World
 * Interactive 2D/3D map node for displaying geospatial and oceanic data. World nodes can contain multiple data layers (gridded data, features, tracks, etc.) and provide map controls, time navigation, and spatial interaction capabilities. Ideal for visualizing spatial data, environmental conditions, and geographic features.
 */
export interface World {
  /**
   * Unique identifier for this world node within the specification. Used for referencing this node in events, interactions, and programmatic access.
   * 
   * @example
   * "map-1"
   * "world-view"
   * "main-map"
   */
  id: string;
  /**
   * Human-readable title for this world node.
   */
  title?: string;
  /**
   * Node type identifier. Must be 'world' for map/globe visualizations.
   */
  nodeType: WorldNodeType;
  /**
   * Array of world layers and controls to display on this map. Each layer represents a different data visualization (e.g., gridded data, vector features, tracks, 3D objects). Layers are rendered in order with later layers appearing on top.
   */
  children: Worldlayer | ControlGroup | EidosPanel[];
  /**
   * Base map layer providing the background cartography. Can be a preset like 'oceanum' or 'satellite-streets', or a custom tile layer configuration.
   */
  baseLayer?: BaseLayer;
  /**
   * Render the basemap over 3D terrain. Independent of baseLayer — works with any basemap source. Worldlayers opt into terrain-relative z with their terrainFollow option.
   */
  terrain?: boolean;
  /**
   * LOD quality dial for multiscale datasources (GeoZarr pyramids, PMTiles). 1 (the default) requests roughly one data cell per screen pixel. Lower is coarser and cheaper, higher is sharper and costlier: 0.5 selects about one pyramid level coarser for ~4x less data, 2 about one level finer for ~4x more — data volume scales with the square of this value. No effect on flat (non-multiscale) datasources, or on a datasource pinned to an explicit group.
   */
  qualityScale?: number;
  /**
   * Initial camera position and orientation for the map view, including center coordinates, zoom level, pitch, and bearing.
   */
  viewState?: View;
  currentTime?: Geojson;
  /**
   * Time control configuration. Set to null to disable the time control, or provide an object to customize its appearance and behavior.
   */
  timeControl?: null | Geojson;
  /**
   * Level control configuration. Set to null to disable the level control, or provide an object to customize its appearance and behavior.
   */
  levelControl?: null | Geojson;
  /**
   * Current level value for the world view
   */
  currentLevel?: number;
  /**
   * Layer selector control configuration. Set to null to disable the layer selector, or provide an object to customize its appearance and behavior.
   */
  layerSelector?: null | LayerSelector;
}

/**
 * Plot
 * Content node that renders a chart from a Vega-Lite specification. Plots can bind to the data sources defined in the root 'data' array and can carry their own current time, timezone and time control.
 */
export interface Plot {
  /**
   * Unique identifier for this plot node within the specification. Used for referencing this node in events, interactions, and programmatic access.
   */
  id: string;
  /**
   * Title of the plot
   */
  title?: string;
  /**
   * Node type identifier. Must be 'plot' for chart nodes.
   */
  nodeType: PlotNodeType;
  /**
   * Unused — the renderer always treats plotSpec as vega-lite (see vega-container.tsx). Kept for backward compatibility with existing specs that set it (EID-102); not removed because plot.json is additionalProperties:false and dropping the property would reject those specs.
   */
  plotType?: "vega" | "vega-lite";
  plotSpec: any & PlotSpec;
  /**
   * Actions to enable for the plot. Unused — vega-container.tsx hardcodes actions:false to the vega-embed call (the export toggle is commented out); the object itself is left open (no additionalProperties:false) for forward compatibility with specs that already set it (EID-102).
   */
  actions?: object;
  /**
   * Resize the plot to fit its container. When true (the default) single/layer views fill the container and vconcat panes are distributed across it; when false the plot keeps its authored width/height and the container scrolls.
   */
  fitToContainer?: boolean;
  timezone?: Geojson;
  currentTime?: Geojson;
  timeControl?: Geojson;
}

/**
 * Document
 * Content node that renders templated markdown text. Use it for narrative content alongside maps and plots, for example a report section or help text in a grid cell or panel.
 */
export interface Document {
  /**
   * Unique identifier for this document node within the specification. Used for referencing this node in events, interactions, and programmatic access.
   */
  id: string;
  /**
   * Title of the document
   */
  title?: string;
  /**
   * Node type identifier. Must be 'document' for markdown content nodes.
   */
  nodeType: DocumentNodeType;
  /**
   * Document content as templated markdown
   */
  content: string;
  /**
   * Style overrides applied to this document only.
   */
  style?: DocumentStyle;
}

/**
 * Grid
 * Layout node that arranges child nodes in a responsive grid pattern. Grid nodes are containers that organize multiple visualization components (maps, plots, documents) into rows and columns. Each child node can span multiple grid cells, allowing for flexible dashboard-style layouts.
 */
export interface Grid {
  /**
   * Unique identifier for this grid node within the specification. Used for referencing this node in events, interactions, and programmatic access.
   * 
   * @example
   * "main-grid"
   * "dashboard-layout"
   * "analysis-grid"
   */
  id: string;
  /**
   * Node type identifier. Must be 'grid' for layout containers that arrange children in a grid pattern.
   */
  nodeType: GridNodeType;
  /**
   * Defines the overall grid dimensions. All child nodes must fit within these bounds. The grid acts as a responsive layout container that adapts to screen size while maintaining relative proportions.
   */
  gridSize: object;
  /**
   * Optional array defining precise positioning for each child node. If provided, must have the same length as the children array. Each element defines the grid position and size for the corresponding child.
   */
  gridLayout?: object[];
  /**
   * Array of child nodes to display within the grid. Children are positioned automatically if gridLayout is not specified, or according to the gridLayout array if provided. Can contain any type of EIDOS node, including `derived` for reusing another node with patches.
   */
  children: Geojson | Plot | Document | Menu | Derived[];
}

/**
 * Menu
 * Layout node that shows one child node at a time, selected through a navigation menu. Each child node is paired with the menuLayout entry at the same index, which supplies its menu label and icon.
 */
export interface Menu {
  /**
   * Unique identifier for this menu node within the specification. Used for referencing this node in events, interactions, and programmatic access.
   */
  id: string;
  /**
   * Node type identifier. Must be 'menu' for menu layout containers.
   */
  nodeType: MenuNodeType;
  /**
   * ID of the child node shown initially. Defaults to the first child. Can be changed at runtime to switch the displayed node.
   */
  activeItem?: string;
  /**
   * Location of menu relative to content. Reserved: not currently applied by the renderer, which always places the menu above the content.
   */
  position?: "top" | "left" | "bottom" | "right";
  /**
   * Whether menu is open. Reserved: not currently used by the renderer.
   */
  open?: boolean;
  /**
   * Child nodes selectable through the menu; one is displayed at a time. Must have the same number of entries as menuLayout, which supplies the menu item for the child at the same index.
   */
  children: Geojson | Plot | Document | Grid | Derived[];
  /**
   * Expand a submenu when the pointer moves over it and collapse it when the pointer leaves, instead of on click. Only affects hierarchical menus (menuLayout entries with a [parent, item] label).
   */
  openOnMouseOver?: boolean;
  /**
   * Menu items, one per child node and paired with children by index. Must have the same number of entries as children: if the lengths differ, no menu items are shown.
   */
  menuLayout: object[];
}

/**
 * Eidos panel
 * A panel is a floating window rendered on top of its parent element. It can contain any node type (world, plot, document, grid, or menu). Panels can be opened by a panelopen control button, by a spec patch, or automatically by an event trigger.
 */
export interface EidosPanel {
  /**
   * Unique ID of the panel. Referenced by panelopen controls via config.panelId.
   */
  id: string;
  /**
   * Node type identifier. Must be 'panel' when present.
   */
  nodeType?: PanelNodeType;
  /**
   * Initial open state. Set to true to open the panel on load. Can also be set via specPatch at runtime to open or close the panel programmatically — the state is one-way (patching open:false closes the panel, but user-initiated closes do not write back to spec).
   */
  open?: boolean;
  /**
   * The content node rendered inside the panel.
   */
  node: Geojson | Plot | Document | Grid | Menu | Derived;
  /**
   * Event patterns that automatically open this panel. The panel opens when **any** pattern in the array matches the most recent event on the event bus (logical OR). Each pattern is compared as a deep subset against the event — the pattern matches when all fields it specifies are equal to the corresponding fields on the event. String values support glob pattern matching. Unspecified fields are ignored.

Use a single-element array for a single trigger; use multiple elements when distinct event shapes (different actions, sources, or data filters) should all open the same panel.

Event fields available to match against:
- action (string): type of event — 'click', 'rightClick', 'doubleClick', 'drop', 'hover', 'viewStateChange', 'activateControl', etc.
- source (string, glob-matched): path identifying what produced the event. Layer interaction sources follow the pattern '/{path}/children/#{layerId}' (e.g. '/root/children/#wave-height'). Use glob wildcards to match multiple sources (e.g. '/root/children/*').
- data (object): event payload — subset-match any fields you care about.
- coordinate ([number, number]): [longitude, latitude] of the interaction point.

Examples:
  Open on any click on a specific layer:
    [ { "action": "click", "source": "/root/children/#my-layer" } ]

  Open from either of two layers:
    [
      { "action": "click", "source": "/root/children/#layer-a" },
      { "action": "click", "source": "/root/children/#layer-b" }
    ]

  Open when a specific control is activated:
    [ { "action": "activateControl", "source": "/root/children/#controls/children/#draw-tool" } ]
   */
  trigger?: Triggerpattern[];
  /**
   * If true, opening this panel closes all other currently open panels. Useful for modal-style panels that should have the user's full attention.
   */
  exclusive?: boolean;
  height?: Geojson;
  width?: Geojson;
  position?: Geojson;
  /**
   * Title displayed in the panel header bar.
   */
  title?: string;
  /**
   * Whether the user can dismiss the panel. When false, the close button is hidden and the panel can only be closed programmatically (via specPatch or a closePanel event). Defaults to true.
   */
  closable?: boolean;
}

/**
 * Eidos style
 * Style properties organized by category
 */
export interface EidosStyle {
  /**
   * Color palette (primary, secondary, accent and background colors).
   */
  color?: ColorStyle;
  /**
   * Typography (text color, font family, sizes, weight, line height and alignment).
   */
  text?: TextStyle;
  /**
   * Styling of control elements.
   */
  control?: ControlStyle;
  /**
   * Styling of floating panels.
   */
  panel?: PanelStyle;
  /**
   * Styling of grid cells.
   */
  grid?: GridStyle;
}

/**
 * Dataset
 * Inline dataset
 */
export interface Dataset {
  /**
   * Optional human-readable name of the dataset.
   */
  name?: string;
  /**
   * Attributes of the dataset
   */
  attributes?: object;
  /**
   * Data variables
   */
  variables: object;
  /**
   * Dimensions of the dataset, mapping each dimension name to its length.
   */
  dimensions: object;
  /**
   * Mapping of the dataset's variables to coordinate dimensions (x: longitude, y: latitude, z: depth/altitude, g: geometry, t: time).
   */
  coordkeys: Coordkeys;
  [key: string]: any;
}

/**
 * Transform
 * Derives a new data source by running user-supplied JavaScript against one or more existing data sources. The code executes in a sandboxed Web Worker and is re-evaluated on every query. Each input is resolved with the propagated consumer query merged per-field against that input's own query overrides (see the inputs items), so a transform can e.g. widen an input to a time window while the app-level time/region selection is still re-applied to the transform's output. The result is validated against the schema for the declared outputType.
 */
export interface Transform {
  /**
   * Human readable name of this transform instance
   */
  name?: string;
  /**
   * ES modules to make available inside the transform function. Each entry maps an identifier name to a module URL; the compiled transform module imports it as `import * as <identifier> from '<url>'`, so the module's namespace object is available inside `code` under that identifier (EID-126; previously bound as an extra function argument — alias references in code are unaffected). Example: { "d3": "https://cdn.jsdelivr.net/npm/d3@7/+esm" } exposes the d3 namespace as `d3` inside `code`.
   */
  modules?: object;
  /**
   * Per-input Datamesh queries resolving the data sources whose results are passed to the transform (EID-125). Each entry's `datasource` must match the `id` of another entry in `data`; an unmodified input is {"datasource": "<data-id>"}. At query time each input is resolved (in declaration order) with the consumer's propagated query merged per-field against the entry's overrides (field present → override, absent → inherit, explicit null → drop), and the results are exposed inside `code` as the `$inputs` object, keyed both positionally ($inputs[0]) and by datasource id ($inputs['my-source']).
   */
  inputs: TransformInput[];
  /**
   * Schema the transform's return value must conform to. `dataset` validates against the inline Dataset schema; `geojson` validates against a GeoJSON FeatureCollection. Validation runs on every query and a failure rejects the query.
   */
  outputType?: "dataset" | "geojson";
  /**
   * Transform code
   * Body of the transform function (no `function` wrapper, no parameter list — just the body, with a `return` statement). The body is compiled into an ES module as `export default async function ($inputs, $query, $outputType) { <code> }` (EID-126) and may use await. Arguments: `$inputs` — object of resolved input data, each entry available both positionally (`$inputs[0]`) and by source ID (`$inputs['my-source']`, the `datasource` ids from the `inputs` array); `$query` — the original query object propagated from the caller (typically containing time/region selections), unaffected by per-input query overrides; `$outputType` — the configured outputType string. Each `modules` entry is imported at the top of the compiled module and its namespace is available under its alias identifier. The return value must match the `outputType` schema.
   */
  code: string;
}

/**
 * GeoJSON
 * GeoJSON schemas
 */
export interface Geojson {
  [key: string]: GeoJSON;
}

/**
 * OceanQuery
 */
export interface Oceanquery {
  /**
   * The id of the datasource
   */
  datasource: string;
  /**
   * Datasource parameters
   */
  parameters?: object | null;
  /**
   * Optional description of this query
   */
  description?: string | null;
  /**
   * List of selected variables
   */
  variables?: string[] | null;
  /**
   * Time filter
   */
  timefilter?: Timefilter | null;
  /**
   * Spatial filter or interpolator
   */
  geofilter?: Geofilter | null;
  /**
   * List of additional coordinate filters
   */
  coordfilter?: Coordselector[] | null;
  /**
   * Spatial reference for filter and output
   */
  crs?: number | string | null;
  /**
   * Aggregate operations
   */
  aggregate?: Aggregate | null;
  /**
   * Limit size of response
   */
  limit?: number | null;
  /**
   * Unique ID of this query
   */
  id?: string | null;
}

/**
 * Zarr group
 * A Zarr group read directly over HTTP. Coordinate variables are identified by coordkeys.
 */
export interface ZarrGroup {
  /**
   * Zarr group URL. For a multiscale (pyramid) store this may point either at the store root — where the renderer detects the levels and can open any of them — or directly at one level's child group (e.g. '.../store.zarr/2') to pin that level manually.
   */
  group: string;
  /**
   * Headers for zarr dataset
   */
  headers?: object;
  /**
   * Mapping of the group's variables to coordinate dimensions (x: longitude, y: latitude, z: depth/altitude, g: geometry, t: time).
   */
  coordkeys: Coordkeys;
  /**
   * Zarr cache duration in seconds. When null or omitted, cached data never expires; 0 disables caching entirely; a positive value invalidates the cache after that many seconds.
   */
  ttl?: number | null;
  /**
   * Forward the renderer authentication headers (Authorization bearer token) to the zarr service
   */
  forwardAuth?: boolean;
}

/**
 * PMTiles archive
 * A PMTiles v3 archive of MVT vector tiles, read directly over HTTP range requests from static hosting (e.g. an R2/S3 object) — there is no tile server in this path. Consumed by the feature worldlayer, which loads tiles on demand for the current view. Mercator archives cannot contain data beyond +/-85.051129 degrees latitude (excluded when the archive is cooked); globe, first-person and VR views render whichever scheme the archive declares on a best-effort basis.
 */
export interface PmtilesArchive {
  /**
   * URL of the .pmtiles archive. The host must support HTTP byte-range requests (Range / 206 responses).
   */
  url: string;
  /**
   * Headers sent with every range request to the archive
   */
  headers?: object;
  /**
   * Forward the renderer authentication headers (Authorization bearer token) to the archive host
   */
  forwardAuth?: boolean;
}

/**
 * WorldLayer
 * A data layer displayed on a world map. World layers visualize different types of geospatial data including gridded datasets (like temperature, wave height), vector features (points, lines, polygons), tracks (moving objects), and 3D scene elements.
 */
export interface Worldlayer {
  /**
   * Unique identifier for this layer within the world node. Used for layer management, visibility control, and programmatic access.
   * 
   * @example
   * "wave-height"
   * "ship-tracks"
   * "weather-stations"
   */
  id: string;
  /**
   * Display name for this layer shown in the layer selector and legend. Should be descriptive and user-friendly.
   * 
   * @example
   * "Significant Wave Height"
   * "Ship Positions"
   * "Weather Stations"
   */
  name?: string;
  /**
   * Node type identifier. Must be 'worldlayer' for data layers of a world node.
   */
  nodeType: WorldlayerNodeType;
  /**
   * Reference to a data source defined in the root 'data' array. This connects the layer to its data source for visualization.
   * 
   * @example
   * "hs-1"
   * "sig-wave-height-trki"
   * "ship-positions"
   */
  dataId?: string;
  /**
   * Whether this layer is initially visible when the map loads. Users can toggle visibility through the layer selector. Set this explicitly: the renderer currently treats an omitted value as false, so a layer without it starts hidden.
   */
  visible?: boolean;
  /**
   * Layer IDs that cannot be displayed at the same time as this layer. An empty array or omitted property means this layer is compatible with all other layers. The relation is symmetric: declaring it on either of the two layers is enough. When a layer becomes visible, any visible layer it excludes is hidden.
   */
  exclusiveOf?: string[];
  /**
   * ID of another layer in the same world node which controls this layer's visibility. A linked layer is shown and hidden together with the layer it is linked to rather than being toggled on its own.
   */
  linked?: string;
  /**
   * Configuration for tooltips displayed when hovering over layer elements. Uses Handlebars templates for dynamic content.
   */
  hoverInfo?: MapHoverInfo;
  /**
   * Display label for this layer. Reserved: not currently used by the renderer. The layer selector shows the legend title, then the layer name, then the layer id.
   */
  label?: string;
  /**
   * ID of a panel associated with this layer. Must match a panel ID in root.panels. Reserved: not currently used by the renderer, which does not open a panel when a layer is selected.
   */
  panel?: string;
  /**
   * Layer-type specific configuration. The layerType property selects the layer implementation (feature, gridded, label, scenegraph, pointcloud, seasurface, track or wmts) and determines which other properties apply.
   */
  layerSpec: Layerspec;
  /**
   * Minimum zoom level at which layer is visible (inclusive). Use a whole number: visibility is re-evaluated when the zoom crosses a whole-number boundary.
   */
  minZoom?: number;
  /**
   * Maximum zoom level at which layer is visible (inclusive). Use a whole number: visibility is re-evaluated when the zoom crosses a whole-number boundary. 0 is treated as unset and falls back to 24.
   */
  maxZoom?: number;
  /**
   * Time selection criteria for layer
   */
  timeSelect?: Timeselect;
  /**
   * Level selection criteria for layer
   */
  levelSelect?: Levelselect;
}

/**
 * Control group
 * A group of map control buttons, laid out in a row or column at a position within the map container.
 */
export interface ControlGroup {
  /**
   * Control group id. Forms part of the event source path of its controls: '<world path>/children/#<group id>/children/#<control id>'.
   */
  id: string;
  /**
   * Node type identifier. Must be set to 'controlgroup': the renderer only recognizes a world child as a control group when this is present.
   */
  nodeType?: ControlgroupNodeType;
  /**
   * Orientation of the control group
   */
  orientation?: "horizontal" | "vertical";
  /**
   * Position of the control group within the map container. Specify top/left/right/bottom as pixel numbers; CSS strings are not supported here. Defaults to top: 100, left: 10 if unset.
   */
  position?: any;
  /**
   * Control list. Controls are shown in order; a group with no controls renders nothing.
   */
  children: Control[];
  /**
   * Visibility of control group. Set this to true explicitly: the renderer currently treats an omitted value as false, so a group without it is not shown.
   */
  visible?: boolean;
}

/**
 * Base layer
 * Base map providing the background cartography: a named preset, a custom Mapbox style, or null for no base map.
 */
export type BaseLayer = Baselayerpreset | CustomBaseLayer | null;

/**
 * Camera configuration defining the initial viewport of the map including position, zoom level, and orientation. This sets how users first see the map when it loads.
 */
export interface View {
  /**
   * Type of world view. 'map' is a standard mercator map, 'globe' renders the world as a globe, 'fp' is a monoscopic first-person view anchored at the longitude/latitude point, 'vr' is the stereoscopic (side-by-side) variant of the first-person view, and 'ar' is a first-person view with no basemap whose camera is driven by an external vessel pose feed (poseSource) over a live camera video background (videoSource). 'vr', 'fp' and 'ar' are only valid when the world node is the root node of the specification.
   */
  viewType?: "map" | "globe" | "vr" | "fp" | "ar";
  /**
   * Longitude coordinate of the map center in decimal degrees (-180 to 180). Positive values are East, negative values are West.
   * 
   * @example
   * 174.3
   * -122.4
   * 2.3
   */
  longitude: number;
  /**
   * Latitude coordinate of the map center in decimal degrees (-90 to 90). Positive values are North, negative values are South.
   * 
   * @example
   * -38.5
   * 37.7
   * 48.9
   */
  latitude: number;
  /**
   * Pitch angle of the view in degrees. For the 'map' and 'globe' view types 0 looks straight down and the camera is limited to the range 0 to maxPitch. The immersive view types ('vr', 'fp', 'ar') also allow a negative pitch, down to -90.
   */
  pitch?: number;
  /**
   * Bearing of the view in degrees clockwise from north. Values outside -180 to 180 are accepted and normalized into that range.
   */
  bearing?: number;
  /**
   * Maximum zoom level the camera can be zoomed in to. If omitted, the renderer uses 18.
   */
  maxZoom?: number;
  /**
   * Initial zoom level of the map. Higher values show more detail. Typically ranges from 0 (world view) to 20+ (street level). May be fractional. If omitted, the renderer uses 5. Not used by the immersive view types ('vr', 'fp', 'ar'), which use position instead.
   * 
   * @example
   * 2
   * 8
   * 12
   */
  zoom?: number;
  /**
   * Maximum pitch angle in degrees. If omitted, the renderer uses 85 for the 'map' and 'globe' view types and 90 for the immersive view types.
   */
  maxPitch?: number;
  /**
   * Camera offset from the longitude/latitude anchor point as [east, north, up] in meters. Only used by the 'vr' and 'fp' view types; the third component sets the camera height above the surface.
   * 
   * @example
   * [0,0,2]
   * [0,0,100]
   */
  position?: number[];
  /**
   * Vertical field of view of the camera in degrees. Only used by the 'vr' and 'fp' view types.
   */
  fov?: number;
  /**
   * Interpupillary distance in meters — the stereo separation between the left and right eye cameras. Only used by the 'vr' view type.
   */
  ipd?: number;
  /**
   * Atmosphere for the immersive view types ('vr'/'fp'), mirroring mapbox setFog(): distant geometry fades to 'color' and the sky blends from 'highColor' down to 'color' at the horizon. Defaults derive the fog color from the basemap style's background.
   */
  fog?: object;
  /**
   * Degree of zoom-out for the 'globe' view type, from actual scale to the full globe: 0 places the camera at true scale (one screen pixel is approximately one meter at the anchor latitude) and 1 zooms all the way out to the whole globe. Takes precedence over 'zoom' when set, and camera interaction keeps it in sync. Only used by the 'globe' view type.
   * 
   * @example
   * 0.85
   * 1
   */
  zoomOut?: number;
  /**
   * External camera pose feed that drives the 'ar' view camera. The reported vessel position and attitude replace user camera interaction: the view continuously re-anchors at the vessel's longitude/latitude with the camera bearing/pitch from the vessel heading and attitude. Only used by the 'ar' view type.
   */
  poseSource?: object;
  /**
   * Live camera video composited behind the transparent deck canvas for the 'ar' view type. Omit for overlay-only AR (layers render against the page background). Only used by the 'ar' view type.
   */
  videoSource?: object;
}

/**
 * Layer selector
 * Layer selector: the panel listing the world node's layers with their legends, where users toggle layer visibility.
 */
export interface LayerSelector {
  /**
   * Whether the layer selector starts expanded. Set this explicitly: the renderer currently treats an omitted value as false, so the selector starts collapsed.
   */
  open?: boolean;
  /**
   * Optional title displayed at the top of the open layer selector (legend panel).
   */
  title?: string;
}

/**
 * Document style
 * Document style overrides
 */
export interface DocumentStyle {
  /**
   * Typography overrides for the document text (color, font family, sizes, weight, line height and alignment).
   */
  text?: any;
}

/**
 * Derived
 * A derived node references another node in the same spec by ID and applies a list of patches at render time. Use it to reuse a chart, document, panel, or other node with small variations (e.g. a different data source or field) without duplicating the source subtree. Resolution and patching happen lazily at render time — derived nodes inside unrendered branches cost nothing, and edits to the source node propagate naturally on the next render.
 */
export interface Derived {
  /**
   * Unique identifier for this derived node within the specification. Replaces the source node's root ID in the rendered subtree, and prefixes every descendant ID so multiple derivations of the same source do not collide.
   * 
   * @example
   * "chart-copy-1"
   * "panel-variant-a"
   */
  id: string;
  /**
   * Optional human-readable title for this derived node.
   */
  title?: string;
  /**
   * Node type identifier. Must be 'derived'.
   */
  nodeType: DerivedNodeType;
  /**
   * ID of the source node to derive from. The renderer looks up this ID in the current spec at render time, deep-clones the source subtree, prefixes descendant IDs with this derived node's ID, rewrites internal cross-references, applies the patches, and renders the result. The root of the spec cannot be a derived node, and the source itself cannot be a derived node.
   * 
   * @example
   * "bar-chart-1"
   * "main-panel"
   */
  source: string;
  /**
   * Ordered list of JSON Patch documents applied to the resolved source subtree after ID and reference rewriting. Paths are subtree-relative — they use RFC 6901 segment syntax (e.g. 'plotSpec/layer/0/data/name') and must NOT start with a leading '/'. The leading-slash form is the JSON Pointer 'absolute against document root' notation and is reserved for future cross-subtree patches; v1 rejects it so the convention mismatch surfaces immediately.
   */
  patches?: object[][];
}

/**
 * TriggerPattern
 * A single event-matching pattern. Deep subset-matched against the event; unspecified fields are wildcards.
 */
export interface Triggerpattern {
  /**
   * Event action to match (e.g. 'click', 'rightClick', 'doubleClick', 'hover', 'drop', 'activateControl'). Glob patterns supported.
   */
  action?: string;
  /**
   * Event source path to match. Layer interactions: '/root/children/#layerId'. Control activations: '/root/children/#controlGroupId/children/#controlId'. Glob patterns supported (e.g. '/root/children/*' matches any child layer).
   */
  source?: string;
  /**
   * Subset of event data fields to match against. Only the fields you specify need to be present and equal in the event.
   */
  data?: object;
}

/**
 * Color style
 * Color palette configuration
 */
export interface ColorStyle {
  /**
   * Primary color of the view
   */
  primary?: string;
  /**
   * Secondary color of the view
   */
  secondary?: string;
  /**
   * Accent color of the view
   */
  accent?: string;
  /**
   * Background color of the view
   */
  background?: string;
}

/**
 * Text style
 * Typography configuration
 */
export interface TextStyle {
  /**
   * Text color of the view
   */
  color?: string;
  /**
   * Font family of the view
   */
  fontFamily?: string;
  /**
   * Font size of the text, as a CSS size string (e.g. '14px', '1rem') or an integer number of pixels
   */
  fontSize?: any;
  /**
   * Font weight of the text, as a CSS font-weight string: 'normal', 'bold', 'bolder', 'lighter' or a numeric weight from 1 to 1000 (e.g. '600')
   */
  fontWeight?: string;
  /**
   * Line height of the text, as a CSS line-height string (e.g. '1.5', '20px'). An integer is interpreted as pixels, so use a string for a unitless multiplier.
   */
  lineHeight?: any;
  /**
   * Text alignment of the view
   */
  align?: string;
  /**
   * Size of the title, as a CSS size string or an integer number of pixels
   */
  titleSize?: any;
  /**
   * Size of the subtitle, as a CSS size string or an integer number of pixels
   */
  subtitleSize?: any;
  /**
   * Size of the heading, as a CSS size string or an integer number of pixels
   */
  headingSize?: any;
}

/**
 * Control style
 * Control element styling
 */
export interface ControlStyle {
  /**
   * Opacity of control elements, as a string holding a number from 0 to 1 (e.g. '0.5')
   */
  opacity?: string;
  /**
   * Border color of control elements
   */
  borderColor?: string;
  /**
   * Background color of control elements
   */
  backgroundColor?: string;
  /**
   * Text color of control elements
   */
  textColor?: string;
  /**
   * Border width of control elements, as a CSS size string or an integer number of pixels
   */
  borderWidth?: any;
  /**
   * Border style of control elements, as a CSS border-style value (one to four of none, hidden, dotted, dashed, solid, double, groove, ridge, inset, outset)
   */
  borderStyle?: string;
  /**
   * Border radius of control elements, as a CSS size string or an integer number of pixels
   */
  borderRadius?: any;
  /**
   * Backdrop filter effect for controls
   */
  backdropFilter?: string;
  /**
   * Box shadow effect for controls
   */
  boxShadow?: string;
  /**
   * Inset box shadow effect for controls
   */
  boxShadowInset?: string;
}

/**
 * Panel style
 * Panel element styling
 */
export interface PanelStyle {
  /**
   * Opacity of panel elements, as a string holding a number from 0 to 1 (e.g. '1.0')
   */
  opacity?: string;
  /**
   * Border color of panel elements
   */
  borderColor?: string;
  /**
   * Background color of panel elements
   */
  backgroundColor?: string;
  /**
   * Text color of panel elements
   */
  textColor?: string;
  /**
   * Border width of panel elements, as a CSS size string or an integer number of pixels
   */
  borderWidth?: any;
  /**
   * Border style of panel elements, as a CSS border-style value (one to four of none, hidden, dotted, dashed, solid, double, groove, ridge, inset, outset)
   */
  borderStyle?: string;
  /**
   * Border radius of panel elements, as a CSS size string or an integer number of pixels
   */
  borderRadius?: any;
  /**
   * Backdrop filter effect for panels
   */
  backdropFilter?: string;
  /**
   * Box shadow effect for panels
   */
  boxShadow?: string;
  /**
   * Inset box shadow effect for panels
   */
  boxShadowInset?: string;
}

/**
 * Grid style
 * Grid element styling
 */
export interface GridStyle {
  /**
   * Border width of grid elements, as a CSS size string or an integer number of pixels
   */
  borderWidth?: any;
  /**
   * Border radius of grid elements, as a CSS size string or an integer number of pixels
   */
  borderRadius?: any;
  /**
   * Border style of grid elements, as a CSS border-style value (one to four of none, hidden, dotted, dashed, solid, double, groove, ridge, inset, outset)
   */
  borderStyle?: string;
  /**
   * Border color of grid elements
   */
  borderColor?: string;
  /**
   * Padding of grid elements, as a CSS size string or an integer number of pixels
   */
  padding?: any;
  /**
   * Margin of grid elements, as a CSS size string or an integer number of pixels. May be negative.
   */
  margin?: any;
  /**
   * Background color of grid elements
   */
  backgroundColor?: string;
}

/**
 * Coordinate keys mapping variables to dimensions (x: longitude, y: latitude, z: depth/altitude, g: geometry, t: time)
 */
export interface Coordkeys {
  [key: string]: object;
}

/**
 * Transform input
 * Datamesh Query resolving one transform input (EID-125). `datasource` is the id of another data source in this specification. The remaining Datamesh query fields merge per-field with the query propagated from the transform's consumer: field present → override, absent → inherit, explicit null → drop that field from the query. Duplicate `datasource` entries (same source, different queries) are legal, but they collide on the named `$inputs` key — the last entry wins; use positional access ($inputs[i]) to disambiguate. Query forms the client engine cannot execute yet (timefilter type 'series', timefilter resolution/resample, non-bbox geofilters, geofilter interp/resolution/alltouched, and non-null coordfilter/aggregate/crs) are schema-valid Datamesh forms but are rejected with a visible error when the transform initializes.
 */
export interface TransformInput {
  /**
   * Id of another data source in this specification (an entry in `data`) that resolves this input.
   */
  datasource: string;
  /**
   * List of selected variables
   * Variables to request from this input. Overrides the consumer query's `variables` (which name the transform's OUTPUT variables); null requests all of the input's variables. The query result contains only the listed variables, so include every variable the transform code reads — including coordinate variables (e.g. lon/lat/time).
   */
  variables?: string[] | null;
  /**
   * Time filter
   * Time filter for this input. Overrides the consumer query's timefilter; null drops it (full time extent).
   */
  timefilter?: TransformInputTimefilter | null;
  /**
   * Spatial filter
   * Datamesh GeoFilter for this input. Overrides the consumer query's geofilter (typically the viewport bbox); null drops it (full spatial extent).
   */
  geofilter?: null;
  /**
   * List of additional coordinate filters
   * Datamesh coordinate selectors for this input, each selecting values along a named coordinate. Not executable by the client engine yet: a non-null value is rejected when the transform initializes.
   */
  coordfilter?: any[] | null;
  /**
   * Aggregate operations
   * Datamesh aggregate operations for this input. Not executable by the client engine yet: a non-null value is rejected when the transform initializes.
   */
  aggregate?: null;
  /**
   * Spatial reference for filter and output
   * Datamesh spatial reference for the filter geometry and the output, as an EPSG code (integer) or a CRS string. Not executable by the client engine yet: a non-null value is rejected when the transform initializes.
   */
  crs?: number | string | null;
}

/**
 * TimeFilter
 */
export interface Timefilter {
  /**
   * Timefilter type
   */
  type?: Timefiltertype;
  /**
   * Time range or series
   */
  times: string | null[];
  /**
   * Temporal resolution of data
   */
  resolution?: string | null;
  /**
   * Resampling operator
   */
  resample?: Resampletype | null;
}

/**
 * GeoFilter
 */
export interface Geofilter {
  /**
   * GeoFilter type
   */
  type?: Geofiltertype;
  /**
   * bbox OR geojson Feature
   */
  geom: number[];
  /**
   * Maximum spatial resolution of data
   */
  resolution?: number | null;
  /**
   * Include all touched grid pixels
   */
  alltouched?: boolean | null;
}

/**
 * CoordSelector
 */
export interface Coordselector {
  /**
   * Coordinate name
   */
  coord: string;
  /**
   * List of coordinate values to select by
   */
  values: string | number[];
}

/**
 * Aggregate
 */
export interface Aggregate {
  /**
   * Aggregate operations to perform
   */
  operations?: AggregateOps[];
  /**
   * Aggregate over spatial filter
   */
  spatial?: boolean | null;
  /**
   * Aggregate over temporal filter
   */
  temporal?: boolean | null;
}

/**
 * Map hover info
 * Properties for tooltip shown on hover
 */
export interface MapHoverInfo {
  /**
   * Tooltip as Handlebars template, rendered as HTML. The render context is the properties of the picked object (or the picked object itself when it has no properties), so the available fields depend on the layer type. The helpers round(value, decimals), multiply(value, factor), add(value, amount) and degrees_to_cardinal(value) are available; each returns '-' for a non-numeric value. An empty result shows no tooltip.
   * 
   * @example
   * "{{name}}: {{round hs 1}} m"
   */
  template: string;
}

/**
 * Layer specification
 */
export type Layerspec = Feature | Gridded | Label | Scenegraph | Pointcloud | Seasurface | Track | Wmts;

/**
 * Time selection criteria for layer
 */
export interface Timeselect {
  /**
   * Time selection mode. 'nearest' selects the time step closest to the current time, within tolerance. 'range' selects every time step from the current time onwards. 'exact' is not currently implemented and applies no time filtering.
   */
  mode: "nearest" | "exact" | "range";
  /**
   * Time tolerance for nearest time select, as an ISO 8601 duration (e.g. 'PT1H'): the nearest time step is only used when it lies within this distance of the current time. Defaults to 'PT60S'.
   * 
   * @example
   * "PT60S"
   * "PT1H"
   * "P1D"
   */
  tolerance?: string;
  /**
   * Time aggregation
   * Aggregation method for time range. Reserved: not currently used by the renderer, which returns the selected time steps unaggregated.
   */
  aggregate?: "last" | "first" | "sum" | "mean" | "max" | "min";
  /**
   * Data variable to group by. In 'nearest' mode, the nearest time step is selected separately for each distinct value of this variable, giving one record per group (e.g. the latest position of each vessel). Applied by feature, label, pointcloud and scenegraph layers.
   */
  groupby?: string;
}

/**
 * Level selection criteria for layer
 */
export interface Levelselect {
  /**
   * Level selection mode. 'nearest' selects the level closest to the current level, within tolerance. 'range' is not usable at present: layers supply a single level rather than a range, so it selects no levels and blanks the layer. 'exact' is not currently implemented and applies no level filtering.
   */
  mode?: "nearest" | "exact" | "range";
  /**
   * Level tolerance for nearest level select, in the units of the level coordinate: the nearest level is only used when it lies within this distance of the current level. When omitted, the nearest level is always used.
   */
  tolerance?: number;
  /**
   * Default level value for this layer, used when the world node supplies no current level.
   */
  level?: number;
}

/**
 * Control
 * A map control button. config is specific to each nodeType.
 */
export type Control = any;

/**
 * Base layer preset. 'oceanum' is the Oceanum cartography; 'outdoors', 'light', 'dark', 'satellite', 'satellite-streets' and 'mapbox' are the standard Mapbox styles. 'terrain' is DEPRECATED — use satellite-streets with the world terrain option instead; legacy specs are normalized to that pairing with a deprecation warning.
 */
export type Baselayerpreset = "oceanum" | "outdoors" | "light" | "dark" | "satellite" | "satellite-streets" | "mapbox" | "terrain";

/**
 * Custom base layer
 * Custom base map defined by a Mapbox style URL and an optional access token.
 */
export interface CustomBaseLayer {
  /**
   * URL to the mapbox style for the base layer
   * 
   * @example
   * "mapbox://styles/mapbox/satellite-streets-v12"
   */
  url?: string;
  /**
   * Authentication token for the base layer
   */
  accessToken?: string;
}

/**
 * Transform input TimeFilter
 * Datamesh TimeFilter for a transform input, with one extension: `times` entries additionally accept signed ISO 8601 durations (e.g. '-PT24H'), resolved against the queried time T (the consumer timefilter's times[0]) at query time — the same idiom as timeControl.range. A null entry is an open-ended bound. When the consumer query has no timefilter (e.g. the transform's init seed query), a duration-anchored window cannot resolve and the timefilter is omitted entirely (full extent). Only type 'range' is executable by the client engine at present.
 */
export interface TransformInputTimefilter {
  /**
   * Timefilter type
   * Type of the time filter. Only 'range' is executable by the client engine at present; 'series' is a schema-valid Datamesh form that is rejected when the transform initializes.
   */
  type?: any;
  /**
   * Time range
   * Time bounds of the filter, as [start, end] for type 'range'. Each entry is an ISO 8601 date-time, a signed ISO 8601 duration resolved against the queried time (e.g. '-PT24H'), or null for an open-ended bound.
   */
  times: string | null[];
  /**
   * Temporal resolution of data
   * Datamesh temporal resolution of the returned data; 'native' keeps the source resolution. Not executable by the client engine yet: any value other than 'native' or null is rejected when the transform initializes.
   */
  resolution?: string | null;
  /**
   * Resampling operator
   * Datamesh operator used when resampling to the requested resolution. Not executable by the client engine yet: any non-null value is rejected when the transform initializes, so omit it or set it to null.
   */
  resample?: null;
}

/**
 * ResampleType
 */
export type Resampletype = "mean" | "nearest";

/**
 * Aggregate Ops
 */
export type AggregateOps = "mean" | "min" | "max" | "std" | "sum";

/**
 * Feature
 * Feature Model
 */
export interface Feature {
  /**
   * Type
   */
  type: "Feature";
  geometry: Geometry;
  /**
   * Properties
   */
  properties?: Properties;
  /**
   * Id
   */
  id?: string;
  /**
   * Bbox
   */
  bbox?: number[];
}

/**
 * Geometry
 * Geometry Model
 */
export type Geometry = Point | Multipoint | Linestring | Multilinestring | Polygon | Multipolygon | Geometrycollection;

/**
 * Point
 * Point Model
 */
export interface Point {
  /**
   * Coordinates
   */
  coordinates: number[];
  /**
   * Type
   */
  type?: Type;
}

/**
 * MultiPoint
 * MultiPoint Model
 */
export interface Multipoint {
  /**
   * Coordinates
   */
  coordinates: number[][];
  /**
   * Type
   */
  type?: Type;
}

/**
 * LineString
 * LineString Model
 */
export interface Linestring {
  /**
   * Coordinates
   */
  coordinates: number[][];
  /**
   * Type
   */
  type?: Type;
}

/**
 * MultiLineString
 * MultiLineString Model
 */
export interface Multilinestring {
  /**
   * Coordinates
   */
  coordinates: number[][][];
  /**
   * Type
   */
  type?: Type;
}

/**
 * Polygon
 * Polygon Model
 */
export interface Polygon {
  /**
   * Coordinates
   */
  coordinates: number[][][];
  /**
   * Type
   */
  type?: Type;
}

/**
 * MultiPolygon
 * MultiPolygon Model
 */
export interface Multipolygon {
  /**
   * Coordinates
   */
  coordinates: number[][][][];
  /**
   * Type
   */
  type?: Type;
}

/**
 * GeometryCollection
 * GeometryCollection Model
 */
export interface Geometrycollection {
  /**
   * Type
   */
  type?: Type;
  /**
   * Geometries
   */
  geometries: Geometry[];
}
