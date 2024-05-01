import { MapActionsTypes } from '../actions/actionsTypes';
//OL modules
import { fromLonLat } from 'ol/proj';
import Map from "ol/Map";
import View from 'ol/View';

const zoom = 5
const center = fromLonLat([-94.9065, 38.9884])

let options = {
    view: new View({ zoom, center }),
    layers:[],
    controls: [],
    overlays: []
};


const mapInitialStore = {
    state:{
        mapObject: new Map(options),
        extent: null,
        isFullMap: true,  
        layers:[],
        toggle_loading_layers: false,
        events:{
            click: null,
            loadstart: null,
            loadend: null,
            pointermove:null
        }
    },
    actions:{}
};


const mapReducer = (state, action) => {
  switch (action.type) {
      case MapActionsTypes.add_layer: // Ensure action types are in all caps to follow conventions

          return {
              ...state,
              state: { // Correctly target the nested `state` object for modification
                  ...state.state,
                  layers: [...state.state.layers, action.payload] // Use `payload` for action data
              }
          };
      case MapActionsTypes.delete_layer:
          return {
              ...state,
              state: {
                  ...state.state,
                  layers: state.state.layers.filter(layer => layer.options['name'] !== action.payload.options.name) // Assume layers are identified by `name`
              }
          };
      case MapActionsTypes.delete_layer_by_name:
            const filtered_array = state.state.layers.filter(layer => layer.options['name'] !== action.payload)
            return {
                ...state,
                state: {
                    ...state.state,
                    layers:filtered_array // Assume layers are identified by `name`
                }
            };

      case MapActionsTypes.toggle_loading_layers:
            return {
                ...state,
                state: {
                    ...state.state,
                    toggle_loading_layers: !state.state.toggle_loading_layers
                }
            };
      case MapActionsTypes.toggle_full_map:
          return {
              ...state,
              state: {
                  ...state.state,
                  isFullMap: !state.state.isFullMap
              }
        };
      case MapActionsTypes.delete_all_layers:
            return {
                ...state,
                state: {
                    ...state.state,
                    layers: []
                }
            };
      case MapActionsTypes.reset_map:
            return {
                ...state,
                state: {
                    ...state.state,
                    mapObject: null
                }
            };
        case MapActionsTypes.add_click_event:
            return {
                ...state,
                state: {
                    ...state.state,
                    events: {
                        ...state.state.events,
                        click: action.payload
                    }
                }
            };
        case MapActionsTypes.add_load_start_event:
            return {
                ...state,
                state: {
                    ...state.state,
                    events: {
                        ...state.state.events,
                        loadstart: action.payload
                    }
                }
            };
        case MapActionsTypes.add_load_end_event:
            return {
                ...state,
                state: {
                    ...state.state,
                    events: {
                        ...state.state.events,
                        loadend: action.payload
                    }
                }
            };
        case MapActionsTypes.add_pointer_move_event:
            return {
                ...state,
                state: {
                    ...state.state,
                    events: {
                        ...state.state.events,
                        pointermove: action.payload
                    }
                }
            };
        case MapActionsTypes.set_extent:
            return {
                ...state,
                state: {
                    ...state.state,
                    extent: action.payload
                }
            };
      default:
          return state;
  }
};

export { mapInitialStore, mapReducer }

