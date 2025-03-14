function UnityProgress(unityInstance, progress) {
    var hr = (new Date()).getHours();
    var isNight = (hr < 6 || hr > 18);
    var splashStyle ="";
    if(isNight) {
        splashStyle = "Dark";
    }
    

    //createjs.CSSPlugin.install(createjs.Tween);
    //createjs.Ticker.setFPS(60);

  if (!unityInstance.Module)
    return;
  if (!unityInstance.logo) {
    unityInstance.logo = document.createElement("div");
    unityInstance.logo.className = "logo " + splashStyle;
    console.log(unityInstance.Module.splashScreenStyle);

    unityInstance.container.appendChild(unityInstance.logo);
  }
  if (!unityInstance.progress) {    
    unityInstance.progress = document.createElement("div");
    unityInstance.progress.className = "progress " + splashStyle;
    unityInstance.progress.empty = document.createElement("div");
    unityInstance.progress.empty.className = "empty";
    unityInstance.progress.appendChild(unityInstance.progress.empty);
    unityInstance.progress.full = document.createElement("div");
    unityInstance.progress.full.className = "full";
    unityInstance.progress.appendChild(unityInstance.progress.full);
    unityInstance.container.appendChild(unityInstance.progress);
  }
    /*
    var length = (141 * progress);
    var negative_length = 141 * (1-progress);

    var bar = document.getElementsByClassName("full")[0];
    var empty_bar = document.getElementsByClassName("empty")[0];
    bar.width=0;
    empty_bar.width = 0;
    createjs.Tween.removeTweens(bar);
    //createjs.Tween.removeTweens(empty_bar);
    console.log(length)
    console.log(negative_length);
    var full_tween = new createjs.Tween.get(bar, { loop: false, override:true }).to({
        width: length
    }, 500, createjs.Ease.sineOut);
    //var empty_tween = new createjs.Tween.get(empty_bar, { loop: false, override:true }).to({
    //   width: negative_length
    //}, 500, createjs.Ease.sineOut);
    
    var timeline = new createjs.Timeline(); //create the Timeline
    timeline.addTween(full_tween);
    */
    //document.getElementById("loadingInfo").innerHTML = this.message;
    //this.SetMessage("Preparing...");
    //document.getElementById("spinner").style.display = "inherit";
    //document.getElementById("bgBar").style.display = "none";
    //document.getElementById("progressBar").style.display = "none";
  unityInstance.progress.full.style.width = (100 * progress) + "%";
  unityInstance.progress.empty.style.width = (100 * (1 - progress)) + "%";
  if (progress == 1)
    unityInstance.logo.style.display = unityInstance.progress.style.display = "none";

}

    
  

/*
function init() {

}

function UnityProgress(unityInstance, progress) {

    var hr = (new Date()).getHours();
    var isNight = (hr < 6 || hr > 18);
    var splashStyle = "";
    if (isNight) {
        splashStyle = "Dark";
    }
    this.progress = 0.0;
    this.message = "";
    this.dom = document.getElementById("unityContainer");

    createjs.CSSPlugin.install(createjs.Tween);
    createjs.Ticker.setFPS(60);

    var parent = this.dom.parentNode;

    this.SetMessage = function (message) {
        this.message = message;
    }
    
    if (!unityInstance.Module)
        return;
    if (!unityInstance.logo) {
        unityInstance.logo = document.createElement("div");
        unityInstance.logo.className = "logo " + splashStyle;
        unityInstance.container.appendChild(unityInstance.logo);
    }

    if (!unityInstance.progress) {
        unityInstance.progress = document.createElement("div");
        unityInstance.progress.className = "progress " + splashStyle;
        unityInstance.progress.empty = document.createElement("div");
        unityInstance.progress.empty.className = "empty";
        unityInstance.progress.appendChild(unityInstance.progress.empty);
        unityInstance.progress.full = document.createElement("div");
        unityInstance.progress.full.className = "full";
        unityInstance.progress.appendChild(unityInstance.progress.full);
        unityInstance.container.appendChild(unityInstance.progress);
        var length = 200 * Math.min(this.progress, 1);
        bar = document.getElementById("progressBar")
        createjs.Tween.removeTweens(bar);
        createjs.Tween.get(bar).to({
            width: length
        }, 500, createjs.Ease.sineOut);
        document.getElementById("loadingInfo").innerHTML = this.message;
        this.SetMessage("Preparing...");
        document.getElementById("spinner").style.display = "inherit";
        document.getElementById("bgBar").style.display = "none";
        document.getElementById("progressBar").style.display = "none";
    }
    if (progress == 1) {
        document.getElementById("loadingBox").style.display = "none";
        unityInstance.logo.style.display = unityInstance.progress.style.display = "none";

    }



}*/
