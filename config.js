'use strict';

function AprilTags() {
  var tags = [];

  var detect = Module.cwrap('detect', 'number', [
    'number', 'number', 'number', 'number'
  ]);

  var detected = Runtime.addFunction(function(
    id, 
    x1,y1,x2,y2,x3,y3,x4,y4,
    m00,m01,m02,m10,m11,m12,m20,m21,m22
  ) {
    tags.push({
      id: id,
      x1: x1, y1: y1,
      x2: x2, y2: y2,
      x3: x3, y3: y3,
      x4: x4, y4: y4,
      m: [m00,m01,m02,m10,m11,m12,m20,m21,m22],
    })
  })

  return function(im) {
    var src_w = im.width;
    var src_h = im.height;

    var mapping_resolution = 1000;

    var downscale = 1;
    if (src_w > mapping_resolution)
        downscale = src_w / mapping_resolution;
    if (src_h > mapping_resolution)
        downscale = Math.max(src_h / mapping_resolution, downscale)

    var w = Math.floor(src_w / downscale);
    var h = Math.floor(src_h / downscale);

    console.log("Creating canvas", w, h);
    var canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;

    var ctx = canvas.getContext("2d");
    ctx.drawImage(im,0,0, w, h);

    console.log("Fetching scaled image");
    var imageData = ctx.getImageData(0, 0, w, h);

    var buf = Module._malloc(imageData.data.length * imageData.data.BYTES_PER_ELEMENT);
    Module.HEAPU8.set(imageData.data, buf);

    console.log("Detecting...");
    tags = [];
    detect(detected, w, h, buf);
    Module._free(buf);

    console.log("Detected", tags);
    return {
      tags: tags,
      width: w,
      height: h,
    }
  }
}

var detector = AprilTags();

const store = new Vuex.Store({
  strict: true,
  state: {
    screens: [],
    snapshot_w: 0,
    snapshot_h: 0,
    show_tags: true,
    is_mapping: false,
    message: "",
  },

  mutations: {
    init(state, {devices, config}) {
      var assigned_unconfigured_screens = [];
      for (var device of devices) {
        if (device.assigned) {
          assigned_unconfigured_screens.push({
            serial: device.serial,
            homography: [],
          });
        }
      }
      assigned_unconfigured_screens.sort(function(a, b) {
        return a.serial.localeCompare(b.serial);
      });
      console.log("sorted assigned screens", assigned_unconfigured_screens);

      var configured_serials = {};
      for (var screen of config.screens) {
        configured_serials[screen.serial] = true;
      }
      console.log("configured serials", configured_serials);

      var changed_assignment = false;
      if (assigned_unconfigured_screens.length != config.screens.length) {
        console.log("assigned screens count doesn't match configured screen count");
        changed_assignment = true;
      } else {
        for (var idx in assigned_unconfigured_screens) {
          var unconfigured_screen = assigned_unconfigured_screens[idx];
          var configured_screen = config.screens[idx];
          if (unconfigured_screen.serial != configured_screen.serial) {
            changed_assignment = true;
            console.log("ordered serial numbers of assigned and configured screens doesn't match");
            break;
          }
        }
      }

      if (changed_assignment) {
        state.message = "New devices have been assigned to this setup. Click on 'Save' to show the configuration tags on all device. Then create a mapping picture.";
        state.screens = assigned_unconfigured_screens;
        state.show_tags = true;
      } else if (config.show_tags) {
        state.message = "Some devices still require a mapping configuration. Create one now by uploading a mapping picture.";
        state.screens = config.screens;
        state.show_tags = true;
      } else {
        state.message = "";
        state.screens = config.screens;
        state.show_tags = config.show_tags;
      }
      state.snapshot_w = config.snapshot_w;
      state.snapshot_h = config.snapshot_h;
    },
    reset_mapping(state) {
      for (var idx in state.screens) {
        var screen = state.screens[idx];
        screen.homography = [];
      }
      state.message = "Mapping removed. Click 'Save' now to display the tags on all devices again, then capture a new mapping picture.";
      state.show_tags = true;
    },
    start_mapping(state) {
      state.is_mapping = true;
    },
    save_mapping(state, {width, height, tags}) {
      state.snapshot_w = width;
      state.snapshot_h = height;

      for (var idx = 0; idx < tags.length; idx++) {
        var tag = tags[idx];
        console.log(tag);
        var screen_id = tag.id-1;
        var homography = tag.m;
        if (screen_id >= 0 && screen_id < state.screens.length) {
          state.screens[screen_id].homography = homography;
        }
      }

      var need_mapping = false;
      for (var idx in state.screens) {
        var screen = state.screens[idx];
        if (screen.homography.length == 0) {
          need_mapping = true;
          break
        }
      }
      if (need_mapping) {
        state.message = "Could not detect all tags in the mapping picture. Please create another one. Make sure that all tags are visible.";
      } else {
        state.show_tags = false;
      }
      state.is_mapping = false;
    },
  },
  actions: {
    init (context, init) {
      context.commit('init', init);
    },
    reset_mapping(context) {
      context.commit('reset_mapping');
    },
    start_mapping(context) {
      context.commit('start_mapping');
    },
    save_mapping(context, mapping) {
      context.commit('save_mapping', mapping);
    },
  }
});

Vue.component('config-ui', {
  template: '#config-ui',
  computed: {
    message() {
      var s = this.$store.state;
      return s.message;
    },
    is_mapping() {
      var s = this.$store.state;
      return s.is_mapping;
    },
    show_tags() {
      var s = this.$store.state;
      return s.show_tags;
    },
    screens() {
      var s = this.$store.state;
      var configured = [];
      for (var idx in s.screens) {
        var screen = s.screens[idx];
        configured.push({
          idx: parseInt(idx),
          serial: screen.serial,
          configured: screen.homography.length > 0,
        })
      }
      return configured;
    },
  },
  methods: {
    onResetMapping() {
      this.$store.dispatch('reset_mapping');
    },
    onDetect(evt) {
      var store = this.$store;
      store.dispatch('start_mapping');
      var reader = new FileReader();
      reader.onload = function(evt) {
          var im = new Image();
          im.onload = function() {
            console.log("Got image");
            var detection = detector(im);
            var tags = detection.tags;
            console.log(tags.length, 'tags detected');
            store.dispatch('save_mapping', {
              width: detection.width,
              height: detection.height,
              tags: tags,
            });
          }
          im.src = evt.target.result;
      }
      reader.readAsDataURL(evt.target.files[0]);     
    }
  }
})

const app = new Vue({
  el: "#app",
  store,
})

ib.setDefaultStyle();
ib.ready.then(() => {
  store.subscribe((mutation, state) => {
    ib.setConfig({
      screens: state.screens,
      snapshot_w: state.snapshot_w,
      snapshot_h: state.snapshot_h,
      show_tags: state.show_tags,
    })
  })
  store.dispatch('init', {
    config: ib.config,
    devices: ib.devices,
  });
})
