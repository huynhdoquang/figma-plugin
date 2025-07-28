// Show the plugin UI
figma.showUI(__html__, { 
  width: 500, 
  height: 700,
  themeColors: true 
});

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'scan-frames') {
      await scanLocalizationFrames();
    } else if (msg.type === 'export-images') {
      await exportImages(msg.data);
    } else if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (error) {
    figma.ui.postMessage({ type: 'export-error', message: error.message });
  }
};

async function scanLocalizationFrames() {
  const frames = [];
  
  // Scan current page for localization frames (same logic as importer)
  function scanNode(node) {
    if (node.type === 'FRAME') {
      // Check if this is a localization frame (contains VI: and EN: text nodes)
      const hasLocalizationTexts = checkForLocalizationTexts(node);
      
      if (hasLocalizationTexts) {
        const imageCount = countImageFrames(node);
        frames.push({
          id: node.id,
          name: node.name,
          width: Math.round(node.width),
          height: Math.round(node.height),
          imageCount: imageCount
        });
      }
      
      // Check children for nested frames
      if ('children' in node) {
        node.children.forEach(scanNode);
      }
    } else if ('children' in node) {
      node.children.forEach(scanNode);
    }
  }
  
  // Scan current page
  figma.currentPage.children.forEach(scanNode);
  
  figma.ui.postMessage({
    type: 'frames-scanned',
    frames: frames
  });
}

function checkForLocalizationTexts(frame) {
  let hasVI = false;
  let hasEN = false;
  
  function checkChildren(node) {
    if (node.type === 'TEXT') {
      if (node.name.startsWith('VI:')) hasVI = true;
      if (node.name.startsWith('EN:')) hasEN = true;
    }
    
    if ('children' in node) {
      node.children.forEach(checkChildren);
    }
  }
  
  checkChildren(frame);
  return hasVI && hasEN;
}

function countImageFrames(frame) {
  let count = 0;
  
  function countChildren(node) {
    if (node.type === 'FRAME' && !node.name.startsWith('📁')) {
      // This is likely an image frame
      const hasImage = node.children.some(child => 
        child.type === 'IMAGE' || 
        child.type === 'RECTANGLE' ||
        (child.fills && child.fills.some(fill => fill.type === 'IMAGE'))
      );
      
      const hasTexts = node.children.some(child => 
        child.type === 'TEXT' && 
        (child.name.startsWith('VI:') || child.name.startsWith('EN:'))
      );
      
      if (hasImage && hasTexts) {
        count++;
      }
    }
    
    if ('children' in node) {
      node.children.forEach(countChildren);
    }
  }
  
  countChildren(frame);
  return count;
}

async function exportImages(data) {
  const { frames, language, resampling, includeBBox, addSuffix } = data;
  
  // Load fonts (same as importer)
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  } catch (error) {
    console.warn("Could not load Inter font, using default");
  }
  
  let exportedCount = 0;
  const allFiles = []; // Store all files for ZIP
  
  // Process each selected frame
  for (const frameId of frames) {
    const frame = figma.currentPage.findOne(n => n.id === frameId);
    if (!frame) continue;
    
    // Find all image frames within this frame
    const imageFrames = [];
    
    function findImageFrames(node, path = '') {
      if (node.type === 'FRAME' && !node.name.startsWith('📁')) {
        // Check if this frame contains image and text elements
        const hasImage = node.children.some(child => 
          child.type === 'IMAGE' || 
          child.type === 'RECTANGLE' ||
          (child.fills && child.fills.some(fill => fill.type === 'IMAGE'))
        );
        
        const hasTexts = node.children.some(child => 
          child.type === 'TEXT' && 
          (child.name.startsWith('VI:') || child.name.startsWith('EN:'))
        );
        
        if (hasImage && hasTexts) {
          imageFrames.push({
            frame: node,
            path: path
          });
        }
      }
      
      if ('children' in node) {
        const currentPath = node.name.startsWith('📁') ? 
          (path ? `${path}/${node.name.replace('📁 ', '')}` : node.name.replace('📁 ', '')) : 
          path;
        
        node.children.forEach(child => findImageFrames(child, currentPath));
      }
    }
    
    findImageFrames(frame);
    
    // Export each image frame
    for (const { frame: imageFrame, path } of imageFrames) {
      const fileData = await exportSingleImageFrame(imageFrame, path, language, resampling, includeBBox, addSuffix);
      if (fileData) {
        allFiles.push(fileData);
        exportedCount++;
      }
    }
  }
  
  // Send all files to UI for ZIP creation
  figma.ui.postMessage({ 
    type: 'create-zip',
    files: allFiles,
    exportedCount: exportedCount
  });
}

async function exportSingleImageFrame(imageFrame, folderPath, language, resampling, includeBBox, addSuffix) {
  // Store original visibility states
  const originalStates = [];
  
  // Find the last child node (original image with extension)
  let originalImageNode = null;
  let detectedFormat = 'PNG'; // default
  
  if (imageFrame.children.length > 0) {
    const lastChild = imageFrame.children[0];
    
    // Check if last child has image extension in name
    if (lastChild.name.toLowerCase().includes('.png')) {
      originalImageNode = lastChild;
      detectedFormat = 'PNG';
    } else if (lastChild.name.toLowerCase().includes('.jpg') || lastChild.name.toLowerCase().includes('.jpeg')) {
      originalImageNode = lastChild;
      detectedFormat = 'JPG';
    }
  }
  
  function storeAndSetVisibility(node) {
    if (node.type === 'TEXT') {
      originalStates.push({
        node: node,
        visible: node.visible
      });
      
      // Set visibility based on language
      if (language === 'vi') {
        node.visible = node.name.startsWith('VI:');
      } else if (language === 'en') {
        node.visible = node.name.startsWith('EN:');
      }
    } else if (node.type === 'RECTANGLE' && node.name.startsWith('BBox:')) {
      // Handle bounding boxes
      originalStates.push({
        node: node,
        visible: node.visible
      });
      node.visible = includeBBox;
    } else if (node === originalImageNode) {
      // Hide only the last child node (original image)
      originalStates.push({
        node: node,
        visible: node.visible
      });
      node.visible = false;
    }
    
    if ('children' in node) {
      node.children.forEach(storeAndSetVisibility);
    }
  }
  
  // Apply visibility changes
  storeAndSetVisibility(imageFrame);
  
  try {
    // Generate filename with suffix
    let filename = imageFrame.name;
    
    if (addSuffix) {
      filename += `_${language}`;
    }
    
    // Export settings based on detected format and resampling
    let exportSettings = {};
    
    if (detectedFormat === 'PNG') {
      exportSettings = {
        format: 'PNG',
        constraint: {
          type: 'SCALE',
          value: 1
        }
      };
    } else if (detectedFormat === 'JPG') {
      exportSettings = {
        format: 'JPG',
        constraint: {
          type: 'SCALE',
          value: 1
        }
      };
    }
    
    // Note: Figma doesn't have direct resampling control in exportAsync
    // The resampling option would typically be handled by Figma's internal rendering
    console.log(`Using ${resampling} resampling for ${filename}`);
    
    // Export the frame
    const exportData = await imageFrame.exportAsync(exportSettings);
    
    // Return file data with detected format
    return {
      data: Array.from(exportData),
      filename: `${filename}.${detectedFormat.toLowerCase()}`,
      path: folderPath,
      mimeType: detectedFormat === 'PNG' ? 'image/png' : 'image/jpeg'
    };
    
  } finally {
    // Restore original visibility states
    originalStates.forEach(({ node, visible }) => {
      node.visible = visible;
    });
  }
  
  return null;
}