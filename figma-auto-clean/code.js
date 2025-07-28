figma.showUI(__html__, { 
  width: 400, 
  height: 650,
  themeColors: true 
});

var cleaningData = {
  imageNode: null,
  bboxNodes: [],
  cleaningAreas: [],
  processingPromise: null
};

figma.ui.onmessage = async function(msg) {
  try {
    switch (msg.type) {
      case 'scan-selection':
        await scanSelection();
        break;
      case 'clean-image':
        await cleanImage(msg.data);
        break;
      case 'image-processed':
        if (cleaningData.processingPromise) {
          cleaningData.processingPromise.resolve(new Uint8Array(msg.data.cleanedBytes));
          cleaningData.processingPromise = null;
        }
        break;
      case 'image-process-error':
        if (cleaningData.processingPromise) {
          cleaningData.processingPromise.reject(new Error(msg.message));
          cleaningData.processingPromise = null;
        }
        break;
      case 'close':
        figma.closePlugin();
        break;
    }
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: error.message });
  }
};

async function scanSelection() {
  var selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Vui lòng chọn ảnh hoặc frame chứa ảnh + bbox' 
    });
    return;
  }
  
  var imageNode = null;
  var bboxNodes = [];
  
  if (selection.length === 1) {
    var selected = selection[0];
    
    if (selected.type === "FRAME") {
      for (var i = 0; i < selected.children.length; i++) {
        var child = selected.children[i];
        
        if (!imageNode && child.type === "RECTANGLE" && child.fills && child.fills.length > 0) {
          for (var j = 0; j < child.fills.length; j++) {
            if (child.fills[j].type === "IMAGE") {
              imageNode = child;
              break;
            }
          }
        }
        
        if (child.type === "RECTANGLE" && child.name.startsWith("BBox:")) {
          bboxNodes.push(child);
        }
      }
    } else if (selected.type === "RECTANGLE" && selected.fills && selected.fills.length > 0) {
      for (var j = 0; j < selected.fills.length; j++) {
        if (selected.fills[j].type === "IMAGE") {
          imageNode = selected;
          break;
        }
      }
    }
  }
  
  if (!imageNode) {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Không tìm thấy ảnh trong selection' 
    });
    return;
  }
  
  cleaningData.imageNode = imageNode;
  cleaningData.bboxNodes = bboxNodes;
  
  var cleaningAreas = [];
  for (var i = 0; i < bboxNodes.length; i++) {
    var bbox = bboxNodes[i];
    var area = {
      id: i,
      name: bbox.name.replace("BBox:", "").trim(),
      x: Math.round(bbox.x - imageNode.x),
      y: Math.round(bbox.y - imageNode.y),
      width: Math.round(bbox.width),
      height: Math.round(bbox.height)
    };
    cleaningAreas.push(area);
  }
  
  cleaningData.cleaningAreas = cleaningAreas;
  
  var imageInfo = {
    name: imageNode.name,
    width: Math.round(imageNode.width),
    height: Math.round(imageNode.height),
    hasImage: false
  };
  
  if (imageNode.fills && imageNode.fills.length > 0) {
    for (var i = 0; i < imageNode.fills.length; i++) {
      if (imageNode.fills[i].type === "IMAGE") {
        imageInfo.hasImage = true;
        break;
      }
    }
  }
  
  figma.ui.postMessage({
    type: 'scan-complete',
    data: {
      imageInfo: imageInfo,
      cleaningAreas: cleaningAreas,
      totalBboxes: bboxNodes.length
    }
  });
}

async function cleanImage(options) {
  if (!cleaningData.imageNode) {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Không có ảnh. Vui lòng scan trước.' 
    });
    return;
  }
  
  var imageNode = cleaningData.imageNode;
  var imageFill = null;
  
  if (imageNode.fills && imageNode.fills.length > 0) {
    for (var i = 0; i < imageNode.fills.length; i++) {
      if (imageNode.fills[i].type === "IMAGE") {
        imageFill = imageNode.fills[i];
        break;
      }
    }
  }
  
  if (!imageFill) {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Không tìm thấy image fill' 
    });
    return;
  }
  
  try {
    var image = figma.getImageByHash(imageFill.imageHash);
    var originalBytes = await image.getBytesAsync();
    
    var cleanedBytes = await processImageCleaning(originalBytes, cleaningData.cleaningAreas, options);
    
    var cleanedImage = figma.createImage(cleanedBytes);
    var cleanedNode = imageNode.clone();
    cleanedNode.name = imageNode.name + " (Cleaned)";
    
    cleanedNode.x = imageNode.x ; ///+ imageNode.width + 20
    cleanedNode.y = imageNode.y;
    
    cleanedNode.fills = [{
      type: "IMAGE",
      scaleMode: imageFill.scaleMode || "FIT",
      imageHash: cleanedImage.hash
    }];
    
    if (imageNode.parent) {
      imageNode.parent.appendChild(cleanedNode);
      imageNode.parent.insertChild(1, cleanedNode);
    } else {
      figma.currentPage.appendChild(cleanedNode);
      figma.currentPage.insertChild(1, cleanedNode);
    }
    
    figma.currentPage.selection = [cleanedNode];
    figma.viewport.scrollAndZoomIntoView([cleanedNode]);
    
    figma.ui.postMessage({
      type: 'clean-success',
      message: 'Xử lý ảnh thành công với phương pháp ' + options.method + '!'
    });
    
  } catch (error) {
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Lỗi xử lý ảnh: ' + error.message 
    });
  }
}

async function processImageCleaning(imageBytes, cleaningAreas, options) {
  return new Promise(function(resolve, reject) {
    cleaningData.processingPromise = { resolve: resolve, reject: reject };
    
    figma.ui.postMessage({
      type: 'process-image',
      data: {
        imageBytes: Array.from(imageBytes),
        cleaningAreas: cleaningAreas,
        options: options
      }
    });
  });
}
