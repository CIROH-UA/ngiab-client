const baseMapLayerURL= 'https://server.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer';
const initialLayersArray = [
  {
      layerType: 'OlTileLayer',
      options: 
      {
          sourceType: 'ArcGISRestTile',
          url: baseMapLayerURL,
          // all the params for the source goes here
          params: {
              LAYERS: 'topp:states',
              Tiled: true,
          },
          // the rest of the attributes are for the definition of the layer
          name: "baseMapLayer",
          zIndex: 1
      },
  },

]


const sldCatchmentStyle = `<?xml version="1.0" encoding="ISO-8859-1"?>
<StyledLayerDescriptor version="1.0.0" 
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd" 
    xmlns="http://www.opengis.net/sld" 
    xmlns:ogc="http://www.opengis.net/ogc" 
    xmlns:xlink="http://www.w3.org/1999/xlink" 
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>nextgen:catchments</Name>
    <UserStyle>
      <FeatureTypeStyle>
        <Rule>
          <PolygonSymbolizer>
          <Fill>
            <CssParameter name="fill">#ccd5e8</CssParameter>
            <CssParameter name="fill-opacity">0.1</CssParameter>
          </Fill>
        <Stroke>
          <CssParameter name="stroke">#000080</CssParameter>
          <CssParameter name="stroke-width">1</CssParameter>
        </Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`

const sldFlowPathsStyle = `<?xml version="1.0" encoding="ISO-8859-1"?>
<StyledLayerDescriptor version="1.0.0" 
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd" 
    xmlns="http://www.opengis.net/sld" 
    xmlns:ogc="http://www.opengis.net/ogc" 
    xmlns:xlink="http://www.w3.org/1999/xlink" 
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>nextgen:flowpaths</Name>
    <UserStyle>
      <FeatureTypeStyle>
        <Rule>
          <LineSymbolizer>
          <Stroke>
            <CssParameter name="stroke">#87CEEB</CssParameter>
            <CssParameter name="stroke-width">2</CssParameter>
          </Stroke>
          </LineSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`


export { initialLayersArray,sldCatchmentStyle,sldFlowPathsStyle }

