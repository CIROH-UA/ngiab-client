import * as am5 from "@amcharts/amcharts5";


const onPointerOver = (event,chart) => {
    var itemContainer = event.target;
    // As series list is data of a legend, dataContext is series
    var currentSeries = itemContainer.dataItem.dataContext;
  
    chart.series.each(function(chartSeries) {
      if (chartSeries != currentSeries) {
        chartSeries.strokes.template.setAll({
          strokeOpacity: 0.5,
        });
      } else {
        chartSeries.strokes.template.setAll({
          strokeWidth: 3,
  
        });
      }
    })
  }
  
  const onPointerOut = (event,chart) => {
    // As series list is data of a legend, dataContext is series
    chart.series.each(function(chartSeries) {
      let strokeWidth = 2;
      chartSeries.strokes.template.setAll({
        strokeOpacity: 1,
        strokeWidth: strokeWidth,
      });
    });
  }

  const initializeLegend = (root,chart,onClick) => {
    // create legend
    var legend = chart.children.push(am5.Legend.new(root, {
      width: am5.percent(100),
      centerY: am5.percent(50),
      useDefaultMarker: true,
      centerX: am5.percent(50),
      x: am5.percent(50),
      layout: am5.GridLayout.new(root, {
        maxColumns: 7,
        fixedWidthGrid: true
      })
  
    }));
    legend.markerRectangles.template.setAll({});
  
    // When legend item container is hovered, dim all the series except the hovered one
    legend.itemContainers.template.events.on("pointerover", function(e) {
      onPointerOver(e,chart);
    })
  
    // When legend item container is unhovered, make all series as they are
    legend.itemContainers.template.events.on("pointerout", function(e) {
      onPointerOut(e,chart);
    })
    if(onClick){
        legend.itemContainers.template.events.on("click", function(e) {
            var targetSeries = e.target.dataItem.dataContext;
            var name_series = targetSeries.get('name');
            onClick(name_series);
        });
    }

    legend.data.setAll(chart.series.values);
  
    return legend
  }

  const createLegendContainer = (root,chart) => {
    let legendContainer = chart.children.push(am5.Container.new(root, {
      // layout: root.verticalLayout
      layout: am5.GridLayout.new(root, {
        maxColumns: 3,
        fixedWidthGrid: true
      })
    
    }));
    legendContainer.set('id','legendContainer')
    return legendContainer
  }

  const createIndividualLegend = (legendContainer,root,chart,heading,onClick) =>{
      //create label
      legendContainer.children.push(am5.Label.new(root, {
        text: heading,
        fontWeight: "bold",
        // paddingLeft: 0
      }));

      // create legend
      var legend = legendContainer.children.push(am5.Legend.new(root, {
        width: am5.percent(100),
        // centerY: am5.percent(50),
        useDefaultMarker: true,
        // centerX: am5.percent(50),
        // x: am5.percent(50),
        layout: root.horizontalLayout
        // layout: am5.GridLayout.new(root, {
        //   maxColumns: 4,
        //   fixedWidthGrid: true
        // })
    
      }));
      legend.set('name',heading)

      legend.markerRectangles.template.setAll({});
    
      // When legend item container is hovered, dim all the series except the hovered one
      legend.itemContainers.template.events.on("pointerover", function(e) {
        onPointerOver(e,chart);
      })
    
      // When legend item container is unhovered, make all series as they are
      legend.itemContainers.template.events.on("pointerout", function(e) {
        onPointerOut(e,chart);
      })
    
      legend.itemContainers.template.events.on("click", function(e) {
        var targetSeries = e.target.dataItem.dataContext;
        var name_series = targetSeries.get('name');
        onClick(name_series);
      });
        
      return legend
  }

  export {initializeLegend,createLegendContainer, createIndividualLegend}