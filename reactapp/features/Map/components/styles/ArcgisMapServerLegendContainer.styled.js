import styled from "styled-components";

export const ArcgisMapServerLegendContainer = styled.div`

    z-index: 1000;
    position: absolute;
    bottom: 0.5rem;
    left:0.5rem;
    background-color: white;
    opacity: 0.8;
    padding: 0.5rem;
    border-radius: 0.5rem;

    .svelte-1x3cf1v{
        display: inline-block;
    }    
    .legendBox.svelte-1x3cf1v {
        width: 100%;
        margin-left: 0.1rem
    }

    .nodataPngTile.svelte-1x3cf1v {
        width: 1.8em;
        height: 2.5em;
        margin-left: 1em
    }

    .pngLegend.svelte-1x3cf1v {
        width: 1.8em;
        height: 2.5em
    }

    figcaption.svelte-1x3cf1v {
        display: table;
        font-size: 8px;
        margin-top: -0.8rem
    }

`;
