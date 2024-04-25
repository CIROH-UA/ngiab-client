import React, { Suspense,useMemo } from 'react';
import {ArcgisMapServerLegendContainer} from './styles/ArcgisMapServerLegendContainer.styled';  // CSS module

const fetchLegend = (url) => 
  fetch(url).then(response => response.json());

const resourceCache = {};

const matcherDict = {
    '> 1.25M,':'High',
    '500K - 1.25M,': '',
    '100K - 500K,': '',
    "50K - 100K,": '',
    "25K - 50K,":'',
    "10K - 25K,":'Normal',
    "5K - 10K,":'',
    "2.5K - 5K,":'',
    "0 - 250,": 'Low',
    "No Data,   (Typically, an intersection with a lake or reservoir.)": "No Data"
}


function createResource(url) {
    if (!resourceCache[url]) {
        let status = 'pending';
        let result;
        let suspender = fetchLegend(url).then(
            r => {
                status = 'success';
                result = r;
            },
            e => {
                status = 'error';
                result = e;
            }
        );

        resourceCache[url] = {
            read() {
                if (status === 'pending') {
                    throw suspender;
                } else if (status === 'error') {
                    throw result;
                }
                return result;
            }
        };
    }
    return resourceCache[url];
}

const LegendComponent = ({ url, layerIndex,title }) => {
    const resource = useMemo(() => createResource(`${url}/legend?f=pjson`), [url]);
    const dataResource = resource.read();

    const legends = dataResource.layers[layerIndex].legend
        .filter(portion => portion.label.includes('Stream Order: 10'))
        .map(portion => ({
            src: `data:image/png;base64,${portion.imageData}`,
            label: matcherDict[portion.label.split('Stream Order: 10').join('').trim()]
        }));   
    return (
        <div className="legendBox svelte-1x3cf1v">
            <h6>{title}</h6>
            {legends.map((legend, index) => (
                <figure key={index} className='svelte-1x3cf1v'>
                    <img className='pngLegend svelte-1x3cf1v' src={legend.src} alt={`Legend of Stream flow anomaly: ${legend.label}`} />
                    <figcaption className="svelte-1x3cf1v">{legend.label}</figcaption>
                </figure>
            ))}
        </div>
    );
};

const ArcgisMapServerLegend = ({ url, layerIndex, title }) => {
    return (
        <ArcgisMapServerLegendContainer>
            <Suspense fallback={<div>Loading legends...</div>}>
                <LegendComponent url={url} layerIndex={layerIndex} title={title} /> 
            </Suspense>
        </ArcgisMapServerLegendContainer>
    );
};


export {ArcgisMapServerLegend};