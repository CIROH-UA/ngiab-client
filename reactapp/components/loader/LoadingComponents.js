import React from 'react';
import styled, { keyframes } from 'styled-components';

// Define the keyframes for the animation
const blinkAnimation = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
`;

// Create a styled component for the loading text
export const LoadingText = styled.div`
  font-size: 16px;
  color: #333;
  display: flex;
  justify-content: center;
  // padding: 20px 10px; // 20px top and bottom, 10px left and right
  animation: ${blinkAnimation} 1.5s infinite;
`;


export const LoaderContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  position: fixed; /* Use fixed to make it cover the entire screen */
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.7); /* Optional: white background with transparency */
  z-index: 1000; /* Ensure it's above other content */

`
