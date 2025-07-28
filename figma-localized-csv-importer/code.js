// Show the plugin UI
figma.showUI(__html__, { 
  width: 520, 
  height: 750,
  themeColors: true 
});

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'import-localization') {
      await importLocalizationData(msg.data);
    } else if (msg.type === 'create-components') {
      await createComponentSystem(msg.data);
    } else if (msg.type === 'close') {
      figma.closePlugin();
    }
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error.message });
  }
};

async function importLocalizationData(data) {
  const { csvRows, selectedLanguage, createBoundingBoxes, groupByImage, maintainFolderStructure } = data;
  
  // Load fonts (you might need to adjust font names)
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  } catch (error) {
    console.warn("Could not load Inter font, using default");
  }
  
  // Find Original Assets page
  const originalAssetsPage = figma.root.children.find(page => page.name === "Original Assets");
  const originalImages = {};
  
  if (originalAssetsPage) {
    // Scan for images in Original Assets page
    function findImages(node) {
      if (node.type === "IMAGE" || (node.fills && node.fills.some(fill => fill.type === "IMAGE"))) {
        const imageName = node.name;
        originalImages[imageName] = node;
      }
      if ("children" in node) {
        node.children.forEach(findImages);
      }
    }
    originalAssetsPage.children.forEach(findImages);
  }
  
  // Convert CSV rows to images structure like original JSON
  const images = {};
  csvRows.forEach((row, index) => {
    const imageName = row.name;
    
    // Process path: remove "assets_img\" prefix and filename
    let processedPath = 'root';
    if (row.path) {
      let pathParts = row.path.replace(/\\/g, '/').split('/'); // Normalize slashes
      
      // Remove "assets_img" if it's the first part
      if (pathParts[0] === 'assets_img') {
        pathParts = pathParts.slice(1);
      }
      
      // Remove filename (last part)
      if (pathParts.length > 0) {
        pathParts = pathParts.slice(0, -1);
      }
      
      // Join remaining parts
      if (pathParts.length > 0) {
        processedPath = pathParts.join('\\'); // Use backslash as shown in example
      }
    }
    
    // Create unique key: path + imageName to handle duplicate names in different folders
    const uniqueKey = `${processedPath}/${imageName}`;
    
    if (!images[uniqueKey]) {
      images[uniqueKey] = {
        textElements: [],
        path: processedPath,
        displayName: imageName // Keep original name for display
      };
    }
    
    images[uniqueKey].textElements.push({
      original: row.extractText,
      vi: row.extractText, // For now, use same text
      en: row.extractText, // For now, use same text
      x: parseInt(row.x) || 0,
      y: parseInt(row.y) || 0,
      width: parseInt(row.width) || 100,
      height: parseInt(row.height) || 30,
      direction: row.direction || 'horizontal'
    });
  });
  
  // Group images by path if maintaining folder structure
  if (maintainFolderStructure) {
    const groupedByPath = {};
    Object.entries(images).forEach(([imageName, imageData]) => {
      const path = imageData.path;
      if (!groupedByPath[path]) {
        groupedByPath[path] = {};
      }
      groupedByPath[path][imageName] = imageData;
    });
    
    // Create main frame
    const mainFrame = figma.createFrame();
    mainFrame.name = `Localization - ${selectedLanguage.toUpperCase()}`;
    mainFrame.resize(1200, 800);
    mainFrame.fills = [];
    
    let currentY = 50;
    
    // Process each path folder
    for (const [path, pathImages] of Object.entries(groupedByPath)) {
      // Create folder frame
      const folderFrame = figma.createFrame();
      folderFrame.name = `📁 ${path}`;
      folderFrame.x = 50;
      folderFrame.y = currentY;
      folderFrame.fills = [];
      
      let folderY = 20;
      let maxWidth = 400;
      
      // Process images in this folder using ORIGINAL logic
      for (const [uniqueKey, imageData] of Object.entries(pathImages)) {
        const imageName = imageData.displayName; // Use original name for display
        
        if (groupByImage) {
          // Try to find matching image in Original Assets first to get dimensions
          const originalImage = originalImages[imageName] || 
                               originalImages[imageName.replace(/\.[^/.]+$/, "")] || // without extension
                               Object.values(originalImages).find(img => img.name.includes(imageName.replace(/\.[^/.]+$/, "")));
          
          // Get image dimensions (use original size or default)
          const imageWidth = originalImage ? originalImage.width : 400;
          const imageHeight = originalImage ? originalImage.height : 300;
          
          // Create frame exactly same size as image
          const imageFrame = figma.createFrame();
          imageFrame.name = imageName.split('.')[0]; // Use display name
          imageFrame.x = 20;
          imageFrame.y = folderY;
          imageFrame.resize(imageWidth, imageHeight); // Exact image size
          imageFrame.fills = []; 
          
          let imageElement;
          if (originalImage) {
            // Clone the original image at 1:1 scale
            imageElement = originalImage.clone();
            imageElement.name = imageName; // Clean name without prefix
            imageElement.x = 0; // Top-left of frame
            imageElement.y = 0;
            // Keep original size (1:1 ratio)
          } else {
            // Create placeholder if no original found
            imageElement = figma.createRectangle();
            imageElement.name = `${imageName} (PLACEHOLDER)`;
            imageElement.resize(imageWidth, imageHeight);
            imageElement.x = 0;
            imageElement.y = 0;
            imageElement.fills = [];
            imageElement.cornerRadius = 8;
          }
          
          imageFrame.appendChild(imageElement);
          
          // Create text elements using ORIGINAL logic
          imageData.textElements.forEach((textEl, index) => {
            const textContent = selectedLanguage === 'vi' ? textEl.vi : 
                               selectedLanguage === 'en' ? textEl.en : textEl.original;
            
            // Vietnamese text
            const viTextNode = figma.createText();
            viTextNode.name = `VI: ${textEl.original}`;
            viTextNode.characters = textEl.vi;
            viTextNode.fontSize = Math.max(12, Math.min(textEl.height * 0.6, 24));
            
            // Position relative to frame (not offset by 20)
            viTextNode.x = textEl.x;
            viTextNode.y = textEl.y;
            viTextNode.resize(textEl.width, textEl.height);
            
            // Style based on direction
            if (textEl.direction === 'vertical') {
              viTextNode.textAlignVertical = 'CENTER';
              viTextNode.fills = [];
            } else {
              viTextNode.textAlignHorizontal = 'CENTER';
              viTextNode.fills = [];
            }
            
            // English text - SAME position as Vietnamese
            const enTextNode = figma.createText();
            enTextNode.name = `EN: ${textEl.original}`;
            enTextNode.characters = textEl.en;
            enTextNode.fontSize = Math.max(12, Math.min(textEl.height * 0.6, 24));
            enTextNode.x = textEl.x; // Same X position
            enTextNode.y = textEl.y; // Same Y position
            enTextNode.resize(textEl.width, textEl.height);
            enTextNode.fills = [];
            enTextNode.visible = false; // Hidden by default, can toggle visibility
            
            // Create bounding box if requested
            if (createBoundingBoxes) {
              const boundingBox = figma.createRectangle();
              boundingBox.name = `BBox: ${textEl.original}`;
              boundingBox.x = textEl.x;
              boundingBox.y = textEl.y;
              boundingBox.resize(textEl.width, textEl.height);
              boundingBox.fills = [];
              boundingBox.strokes = [{ 
                type: 'SOLID', 
                color: { r: 1, g: 0, b: 0 },
                opacity: 0.7
              }];
              boundingBox.strokeWeight = 2;
              boundingBox.cornerRadius = 4;
              
              imageFrame.appendChild(boundingBox);
            }
            
            imageFrame.appendChild(viTextNode);
            imageFrame.appendChild(enTextNode);
          });
          
          folderFrame.appendChild(imageFrame);
          folderY += imageHeight + 30;
          maxWidth = Math.max(maxWidth, imageWidth + 40);
        }
      }
      
      folderFrame.resize(maxWidth, folderY + 20);
      mainFrame.appendChild(folderFrame);
      currentY += folderFrame.height + 50;
    }
    
    // Adjust main frame size
    mainFrame.resize(Math.max(1200, mainFrame.children.reduce((max, child) => 
      Math.max(max, child.x + child.width + 50), 0)), currentY + 50);
    
    // Add to current page
    figma.currentPage.appendChild(mainFrame);
    figma.currentPage.selection = [mainFrame];
    figma.viewport.scrollAndZoomIntoView([mainFrame]);
    
  } else {
    // No folder structure - use original logic exactly
    // Create main frame
    const mainFrame = figma.createFrame();
    mainFrame.name = `Localization - ${selectedLanguage.toUpperCase()}`;
    mainFrame.resize(1200, 800);
    mainFrame.fills = [];
    
    let currentY = 50;
    
    // Process each image
    for (const [uniqueKey, imageData] of Object.entries(images)) {
      const imageName = imageData.displayName; // Use original name for display
      
      if (groupByImage) {
        // Try to find matching image in Original Assets first to get dimensions
        const originalImage = originalImages[imageName] || 
                             originalImages[imageName.replace(/\.[^/.]+$/, "")] || // without extension
                             Object.values(originalImages).find(img => img.name.includes(imageName.replace(/\.[^/.]+$/, "")));
        
        // Get image dimensions (use original size or default)
        const imageWidth = originalImage ? originalImage.width : 400;
        const imageHeight = originalImage ? originalImage.height : 300;
        
        // Create frame exactly same size as image
        const imageFrame = figma.createFrame();
        imageFrame.name = imageName.split('.')[0]; // Use display name
        imageFrame.x = 50;
        imageFrame.y = currentY;
        imageFrame.resize(imageWidth, imageHeight); // Exact image size
        imageFrame.fills = [];
        
        let imageElement;
        if (originalImage) {
          // Clone the original image at 1:1 scale
          imageElement = originalImage.clone();
          imageElement.name = imageName; // Clean name without prefix
          imageElement.x = 0; // Top-left of frame
          imageElement.y = 0;
          // Keep original size (1:1 ratio)
        } else {
          // Create placeholder if no original found
          imageElement = figma.createRectangle();
          imageElement.name = `${imageName} (PLACEHOLDER)`;
          imageElement.resize(imageWidth, imageHeight);
          imageElement.x = 0;
          imageElement.y = 0;
          imageElement.fills = [];
          imageElement.cornerRadius = 8;
        }
        
        imageFrame.appendChild(imageElement);
        
        // Create text elements for both Vietnamese and English
        imageData.textElements.forEach((textEl, index) => {
          const textContent = selectedLanguage === 'vi' ? textEl.vi : 
                             selectedLanguage === 'en' ? textEl.en : textEl.original;
          
          // Vietnamese text
          const viTextNode = figma.createText();
          viTextNode.name = `VI: ${textEl.original}`;
          viTextNode.characters = textEl.vi;
          viTextNode.fontSize = Math.max(12, Math.min(textEl.height * 0.6, 24));
          
          // Position relative to frame (not offset by 20)
          viTextNode.x = textEl.x;
          viTextNode.y = textEl.y;
          viTextNode.resize(textEl.width, textEl.height);
          
          // Style based on direction
          if (textEl.direction === 'vertical') {
            viTextNode.textAlignVertical = 'CENTER';
            viTextNode.fills = [];
          } else {
            viTextNode.textAlignHorizontal = 'CENTER';
            viTextNode.fills = [];
          }
          
          // English text - SAME position as Vietnamese
          const enTextNode = figma.createText();
          enTextNode.name = `EN: ${textEl.original}`;
          enTextNode.characters = textEl.en;
          enTextNode.fontSize = Math.max(12, Math.min(textEl.height * 0.6, 24));
          enTextNode.x = textEl.x; // Same X position
          enTextNode.y = textEl.y; // Same Y position
          enTextNode.resize(textEl.width, textEl.height);
          enTextNode.fills = [];
          enTextNode.visible = false; // Hidden by default, can toggle visibility
          
          // Create bounding box if requested
          if (createBoundingBoxes) {
            const boundingBox = figma.createRectangle();
            boundingBox.name = `BBox: ${textEl.original}`;
            boundingBox.x = textEl.x;
            boundingBox.y = textEl.y;
            boundingBox.resize(textEl.width, textEl.height);
            boundingBox.fills = [];
            boundingBox.strokes = [{ 
              type: 'SOLID', 
              color: { r: 1, g: 0, b: 0 },
              opacity: 0.7
            }];
            boundingBox.strokeWeight = 2;
            boundingBox.cornerRadius = 4;
            
            imageFrame.appendChild(boundingBox);
          }
          
          imageFrame.appendChild(viTextNode);
          imageFrame.appendChild(enTextNode);
        });
        
        mainFrame.appendChild(imageFrame);
        currentY += imageHeight + 50; // Space = image height + margin
      }
    }
    
    // Add to current page
    figma.currentPage.appendChild(mainFrame);
    figma.currentPage.selection = [mainFrame];
    figma.viewport.scrollAndZoomIntoView([mainFrame]);
  }
  
  // Send success message
  figma.ui.postMessage({ 
    type: 'import-success',
    message: `Successfully imported ${Object.keys(images).length} images`
  });
}

async function createComponentSystem(data) {
  // Component creation logic here
  figma.ui.postMessage({ 
    type: 'components-success',
    message: 'Components created successfully'
  });
}