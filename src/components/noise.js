import * as Tone from 'tone'

export default {
  name: 'Noise',

  data: () => ({
    mainPlayLoading: true,
    isTimerValid: false,
    selectedProfile: {},
    profileItems: [],
    profileDialog: false,
    profileName: '',
    isProfileValid: false,
    profileMoreDialog: false,
    importDialog: false,
    isImportValid: false,
    exportDialog: false,
    importedProfile: null,
    importedProfileName: '',
    exportedProfile: {},
    infoSnackbar: false,
    infoSnackbarText: '',
    playDisabled: false,
    isRecording: false,
    recordingStarting: false,
    recordingFinishing: false,
    isTimerEnabled: false,
    hours: 0,
    minutes: 0,
    seconds: 30,
    duration: 30,
    timeRemaining: 0,
    noiseColor: 'pink',
    noiseColorItems: ['pink', 'white', 'brown'],
    volume: -10,
    isFilterEnabled: false,
    filterCutoff: 1000,
    filterType: 'lowpass',
    filterTypeItems: ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'notch', 'allpass', 'peaking'],
    isLFOFilterCutoffEnabled: false,
    lfoFilterCutoffFrequency: 0.5,
    lfoFilterCutoffMin: 0,
    lfoFilterCutoffMax: 5000,
    lfoFilterCutoffRange: [100, 5000],
    isTremoloEnabled: false,
    tremoloFrequency: 0.5,
    tremoloDepth: 0.5,
    isReverbEnabled: false,
    allSamples: [],
    loadedSamples: [],
    selectedSample: null,
    uploadSampleDialog: false,
    addSampleDialog: false,
    checkedSamples: [],
    sampleName: '',
    isSampleUploadValid: false,
    canUpload: false,
    editSampleDialog: false,
    previewSampleLoopPointsEnabled: false,
    previewSampleLoopStart: 0,
    previewSampleLoopEnd: 0,
    previewSampleFadeIn: 0,
    previewSamplePlaying: false,
    selectedPreviewSample: {},
    previewSampleItems: [],
    isEditSampleValid: false,
    previewSampleButtonText: 'Preview Sample',
    previewSampleLoading: true,
    previewSampleLength: 0,
    startRecordingDialog: false,
    recordingDialog: false,
    recordingTimeElapsed: 0,
    recordedProfile: {},
    recordingFileName: '',
    isRecordingValid: false,
    unsavedWork: false,
    saveProfileText: 'Save Profile',
    unwatch: null,
    confirmSwitchProfileDialog: false,
    activeProfile: {},
    isSporadicValid: false,
    errorSnackbar: false,
    errorSnackbarText: '',
    rules: {
      lt (n) {
        return value => (!isNaN(parseInt(value, 10)) && value < n) || 'Must be less than ' + n
      },
      gt (n) {
        return value => (!isNaN(parseInt(value, 10)) && value > n) || 'Must be greater than ' + n
      },
      required () {
        return value => !!value || 'Required'
      }
    }
  }),
  computed: {
    unloadedSamples: function () {
      const samples = []
      this.allSamples.forEach(s1 => {
        const result = this.loadedSamples.find(s2 => s2.id === s1.id)
        if (!result) {
          samples.push(s1)
        }
      })
      return samples
    },
    changeableSettings: function () {
      const settings = [
        this.isTimerEnabled,
        this.hours,
        this.minutes,
        this.seconds,
        this.volume,
        this.noiseColor,
        this.isFilterEnabled,
        this.filterType,
        this.filterCutoff,
        this.isLFOFilterCutoffEnabled,
        this.lfoFilterCutoffFrequency,
        this.lfoFilterCutoffRange,
        this.isTremoloEnabled,
        this.tremoloDepth,
        this.tremoloFrequency,
        this.isTimerEnabled,
        this.loadedSamples
      ]

      this.loadedSamples.forEach(s => {
        settings.push(s.volume)
        settings.push(s.reverbEnabled)
        settings.push(s.reverbPreDelay)
        settings.push(s.reverbDecay)
        settings.push(s.reverbWet)
        settings.push(s.playbackMode)
        settings.push(s.sporadicMin)
        settings.push(s.sporadicMax)
      })

      return settings
    }
  },
  created () {
    this.players = new Tone.Players()
    this.samplePreviewPlayer = new Tone.Player().toDestination()
    this.samplePreviewPlayer.loop = true

    // Audio graph state. The playback/recording graph is built when playback
    // (or recording) starts and fully torn down when it ends, so that no
    // nodes, connections or timers survive between sessions.
    this.noise = null
    this.filter = null
    this.tremolo = null
    this.lfo = null
    this.recorder = null
    this.recordBus = null
    this.sampleReverbs = []
    this.activePlayerIds = []
    this.sessionSamples = null
    this.sporadicTimers = new Set()
    this.playbackActive = false
    this.transportInterval = null
    this.timeRemainingInterval = null
    this.recordingInterval = null
    this.recordingSession = 0
    this.recordingStartToken = null
    this.preRecordingSettings = null
    this.graphTarget = null

    this.populateProfileItems(0)
    this.populatePreviewSampleItems()
    this.getSamples()
    this.getCurrentUser()
  },
  beforeDestroy () {
    // Abort any in-flight recording (no download), tear down the audio graph
    // and release the long-lived players.
    this.recordingSession++
    this.recordingStarting = false
    this.isRecording = false
    this.recordingFinishing = true

    clearInterval(this.recordingInterval)
    this.recordingInterval = null

    this.stopPlayback()
    this.disposeAudioResources()
  },
  methods: {
    async play () {
      if (!this.players || !this.players.loaded) {
        return
      }

      // Never start playback on top of an in-flight recording session.
      if (this.isRecording || this.recordingStarting || this.recordingFinishing) {
        return
      }

      await Tone.start()

      // Rebuild from scratch: no node, connection or timer from a previous
      // playback/recording session may leak into this one.
      this.stopPlayback()

      this.playDisabled = true
      this.playbackActive = true
      this.graphTarget = Tone.Destination

      const samples = this.loadedSamples.slice()
      this.sessionSamples = samples
      this.activePlayerIds = samples.map(s => s.id)

      try {
        this.createSourceChain(Tone.Destination)

        if (this.isTimerEnabled) {
          this.duration = parseInt((this.hours * 3600)) + parseInt((this.minutes * 60)) + parseInt(this.seconds)
          this.timeRemaining = this.duration
          this.transportInterval = setInterval(() => this.stop(), this.duration * 1000 + 100)
          this.timeRemainingInterval = setInterval(() => this.startTimer(), 1000)
          Tone.Transport.loopEnd = this.duration

          this.noise.sync().start(0).stop(this.duration)
        } else {
          this.noise.sync().start(0)
        }

        samples.forEach(s => this.routeSample(s, Tone.Destination))
        this.scheduleSamples(samples, true)

        Tone.Transport.start('+0.1')
      } catch (e) {
        this.stopPlayback()
        throw e
      }
    },
    createSourceChain (target, existingNoise) {
      const noise = existingNoise || new Tone.Noise({ volume: this.volume, type: this.noiseColor })

      // Rewire from scratch: the noise source may already be running (effect
      // toggled mid-playback), so only its outgoing connections are replaced.
      noise.disconnect()

      let filter = null
      let tremolo = null

      if (!this.isFilterEnabled && !this.isTremoloEnabled) {
        noise.connect(target)
      } else if (!this.isFilterEnabled && this.isTremoloEnabled) {
        tremolo = new Tone.Tremolo({ frequency: this.tremoloFrequency, depth: this.tremoloDepth }).connect(target).start()
        noise.connect(tremolo)
      } else if (this.isFilterEnabled && !this.isTremoloEnabled) {
        filter = new Tone.Filter(this.filterCutoff, this.filterType).connect(target)
        noise.connect(filter)
      } else {
        tremolo = new Tone.Tremolo({ frequency: this.tremoloFrequency, depth: this.tremoloDepth }).connect(target).start()
        filter = new Tone.Filter(this.filterCutoff, this.filterType).connect(tremolo)
        noise.connect(filter)
      }

      let lfo = null
      if (this.isFilterEnabled && this.isLFOFilterCutoffEnabled) {
        lfo = new Tone.LFO({ frequency: this.lfoFilterCutoffFrequency, min: this.lfoFilterCutoffRange[0], max: this.lfoFilterCutoffRange[1] })
        lfo.connect(filter.frequency).start()
      }

      this.noise = noise
      this.filter = filter
      this.tremolo = tremolo
      this.lfo = lfo
    },
    routeSample (sample, target) {
      const player = this.players.player(sample.id)

      // Drop anything left over from a previous session before rewiring.
      player.unsync()
      player.disconnect()

      player.loop = true
      player.fadeIn = sample.fadeIn

      if (sample.loopPointsEnabled) {
        player.setLoopPoints(sample.loopStart, sample.loopEnd)
      } else {
        player.setLoopPoints(0, player.buffer.duration)
      }

      player.volume.value = sample.volume

      if (sample.reverbEnabled) {
        const reverb = new Tone.Reverb(sample.reverbDecay)
        reverb.set({ preDelay: sample.reverbPreDelay, wet: sample.reverbWet })
        reverb.connect(target)
        player.connect(reverb)
        this.sampleReverbs.push(reverb)
      } else {
        player.connect(target)
      }
    },
    scheduleSamples (samples, useTimer) {
      samples.forEach(s => {
        const player = this.players.player(s.id)

        if (s.playbackMode === 'sporadic') {
          player.loop = false

          const maxInt = parseInt(s.sporadicMax, 10)
          const minInt = parseInt(s.sporadicMin, 10)

          if (!isNaN(minInt) && !isNaN(maxInt) && minInt <= maxInt) {
            const rand = Math.floor(Math.random() * (maxInt - minInt + 1) + minInt)
            const handle = setInterval(() => this.playSporadicSample(s.id), rand * 1000)
            this.trackSporadicTimer(s, handle, true)
          }
        } else {
          player.loop = true
          player.unsync().sync()

          if (useTimer) {
            player.start(0).stop(this.duration)
          } else {
            player.start(0)
          }
        }
      })
    },
    playSporadicSample (id) {
      if (!this.playbackActive) {
        return
      }

      const sessionSamples = this.sessionSamples || []
      const sample = sessionSamples.find(s => s.id === id) || (this.loadedSamples || []).find(s => s.id === id)

      if (!sample) {
        return
      }

      this.clearSampleSporadicTimers(sample)

      this.players.player(id).unsync().sync().start()

      const maxInt = parseInt(sample.sporadicMax, 10)
      const minInt = parseInt(sample.sporadicMin, 10)

      if (isNaN(minInt) || isNaN(maxInt) || minInt > maxInt) {
        return
      }

      sample.playNextTime = Math.floor(Math.random() * (maxInt - minInt + 1) + minInt)

      const handle = setInterval(() => this.playSporadicSample(id), sample.playNextTime * 1000)
      this.trackSporadicTimer(sample, handle, false)
    },
    trackSporadicTimer (sample, handle, isInitial) {
      this.sporadicTimers.add(handle)

      if (!sample) {
        return
      }

      if (isInitial) {
        sample.initialSporadicPlayInterval = handle
      } else {
        sample.sporadicInterval = handle
      }
    },
    clearSampleSporadicTimers (sample) {
      if (!sample) {
        return
      }

      if (sample.initialSporadicPlayInterval) {
        clearInterval(sample.initialSporadicPlayInterval)
        this.sporadicTimers.delete(sample.initialSporadicPlayInterval)
        sample.initialSporadicPlayInterval = null
      }

      if (sample.sporadicInterval) {
        clearInterval(sample.sporadicInterval)
        this.sporadicTimers.delete(sample.sporadicInterval)
        sample.sporadicInterval = null
      }
    },
    clearSporadicTimers () {
      this.sporadicTimers.forEach(handle => clearInterval(handle))
      this.sporadicTimers.clear()

      // The recording session swaps `loadedSamples` for the recorded profile's
      // samples, so timers created during recording must also be cleared on
      // the sample objects belonging to that session.
      const samples = (this.sessionSamples || []).concat(this.loadedSamples || [])
      samples.forEach(sample => this.clearSampleSporadicTimers(sample))
    },
    stop () {
      // The transport-level stop must never leave a recording graph running:
      // while recording it aborts the recording (without a download).
      if (this.isRecording || this.recordingStarting) {
        this.cancelRecording()
        return
      }

      this.stopPlayback()
    },
    stopPlayback () {
      clearInterval(this.transportInterval)
      this.transportInterval = null

      clearInterval(this.timeRemainingInterval)
      this.timeRemainingInterval = null

      clearInterval(this.recordingInterval)
      this.recordingInterval = null

      this.clearSporadicTimers()

      if (this.players) {
        this.activePlayerIds.forEach(id => {
          try {
            const player = this.players.player(id)
            player.unsync()
            player.stop()
            player.disconnect()
          } catch (e) {
            // The sample may have been removed after it was routed.
          }
        })
      }
      this.activePlayerIds = []

      try {
        Tone.Transport.stop()
      } catch (e) {
        // Transport is already stopped.
      }

      try {
        Tone.Transport.cancel()
      } catch (e) {
        // There is nothing scheduled.
      }

      this.teardownAudioGraph()

      this.sessionSamples = null
      this.playbackActive = false
      this.timeRemaining = 0
      this.playDisabled = false
    },
    teardownAudioGraph () {
      this.teardownSourceChain()

      this.sampleReverbs.forEach(reverb => this.safeDispose(reverb))
      this.sampleReverbs = []

      if (this.recordBus) {
        this.safeDispose(this.recordBus)
        this.recordBus = null
      }

      this.releaseRecorder()
    },
    teardownSourceChain () {
      this.teardownSourceEffects()
      this.safeDispose(this.noise)
      this.noise = null
    },
    teardownSourceEffects () {
      this.safeDispose(this.lfo)
      this.safeDispose(this.tremolo)
      this.safeDispose(this.filter)

      this.lfo = null
      this.tremolo = null
      this.filter = null
    },
    releaseRecorder () {
      const recorder = this.recorder
      this.recorder = null

      if (!recorder) {
        return Promise.resolve()
      }

      // Already stopped: free it synchronously so the graph is clean as soon
      // as teardown returns.
      if (recorder.state === 'stopped') {
        this.disposeRecorderNode(recorder)
        return Promise.resolve()
      }

      let stopped
      try {
        stopped = recorder.stop()
      } catch (e) {
        stopped = Promise.resolve()
      }

      return Promise.resolve(stopped)
        .catch(() => {})
        .then(() => this.disposeRecorderNode(recorder))
    },
    disposeRecorderNode (recorder) {
      // The recorder has already been stopped; only dispose it here so its
      // input, MediaStream destination and MediaRecorder are freed without a
      // second stop() call.
      try {
        recorder.dispose()
      } catch (e) {
        // The recorder has already been disposed.
      }
    },
    safeDispose (node) {
      if (!node) {
        return
      }

      try {
        if (typeof node.unsync === 'function') {
          node.unsync()
        }
      } catch (e) {
        // The node is not synced to the transport.
      }

      try {
        if (typeof node.stop === 'function') {
          node.stop()
        }
      } catch (e) {
        // The node is not running.
      }

      try {
        node.dispose()
      } catch (e) {
        // The node has already been disposed.
      }
    },
    disposeAudioResources () {
      this.stopPlayback()

      if (this.players) {
        try {
          this.players.stopAll()
        } catch (e) {
          // There are no players to stop.
        }
        this.safeDispose(this.players)
        this.players = null
      }

      this.safeDispose(this.samplePreviewPlayer)
      this.samplePreviewPlayer = null
    },
    startTimer () {
      this.timeRemaining -= 1
    },
    updateVolume () {
      if (this.noise) {
        this.noise.volume.value = this.volume
      }
    },
    updateNoiseColor () {
      if (this.noise) {
        this.noise.type = this.noiseColor
      }
    },
    updateFilterType () {
      if (this.filter) {
        this.filter.type = this.filterType
      }
    },
    updateFilterCutoff () {
      if (this.filter) {
        this.filter.set({ frequency: this.filterCutoff })
      }
    },
    updateLFOFilterCutoffFrequency () {
      if (this.lfo) {
        this.lfo.set({ frequency: this.lfoFilterCutoffFrequency })
      }
    },
    updateLFOFilterCutoffRange () {
      if (this.lfo) {
        this.lfo.set({ min: this.lfoFilterCutoffRange[0], max: this.lfoFilterCutoffRange[1] })
      }
    },
    updateTremoloFrequency () {
      if (this.tremolo) {
        this.tremolo.set({ frequency: this.tremoloFrequency })
      }
    },
    updateTremoloDepth () {
      if (this.tremolo) {
        this.tremolo.set({ depth: this.tremoloDepth })
      }
    },
    updateAudioChain () {
      // Toggling effects only matters while a playback graph exists. Otherwise
      // the settings are simply applied the next time playback starts.
      if (!this.playbackActive || this.isRecording || this.recordingStarting || this.recordingFinishing) {
        return
      }

      const target = this.graphTarget || Tone.Destination

      // Detach the source from the old effects before disposing them, then
      // rebuild the chain around the still-running noise source.
      if (this.noise) {
        this.noise.disconnect()
      }
      this.teardownSourceEffects()
      this.createSourceChain(target, this.noise)
    },
    populateProfileItems (profileId) {
      this.$http.get('/profiles')
        .then(response => {
          if (response.status === 200) {
            if (response.data.profiles.length === 0) {
              this.addDefaultProfile()
            } else {
              this.profileItems = response.data.profiles
              if (profileId === 0) {
                this.selectedProfile = this.profileItems[0]
              } else {
                this.selectedProfile = this.profileItems.find(p => p.id === profileId)
              }
              this.exportedProfile = this.profileItems[0]
              this.recordedProfile = this.profileItems[0]
              this.loadProfile(true)
            }
          }
        })
    },
    addDefaultProfile () {
      this.$http.post('/profiles/default')
        .then(response => {
          if (response.status === 200) {
            const defaultProfile = { id: response.data.id, text: 'Default' }
            this.profileItems = [defaultProfile]
            this.selectedProfile = defaultProfile
          }
        })
    },
    saveProfile () {
      this.$http.post('/profiles', {
        name: this.profileName,
        isTimerEnabled: this.isTimerEnabled,
        duration: this.duration,
        volume: this.volume,
        noiseColor: this.noiseColor,
        isFilterEnabled: this.isFilterEnabled,
        filterType: this.filterType,
        filterCutoff: this.filterCutoff,
        isLFOFilterCutoffEnabled: this.isLFOFilterCutoffEnabled,
        lfoFilterCutoffFrequency: this.lfoFilterCutoffFrequency,
        lfoFilterCutoffLow: this.lfoFilterCutoffRange[0],
        lfoFilterCutoffHigh: this.lfoFilterCutoffRange[1],
        isTremoloEnabled: this.isTremoloEnabled,
        tremoloFrequency: this.tremoloFrequency,
        tremoloDepth: this.tremoloDepth,
        samples: this.loadedSamples
      }).then(response => {
        if (response.status === 200) {
          this.profileDialog = false
          this.populateProfileItems(response.data.id)
          this.unsavedWork = false
          this.infoSnackbarText = 'Profile Saved'
          this.infoSnackbar = true
        }
      })
        .catch(() => {
          this.errorSnackbarText = 'Error Saving Profile'
          this.errorSnackbar = true
        })
    },
    updateProfile () {
      return this.$http.put('/profiles/'.concat(this.selectedProfile.id), {
        isTimerEnabled: this.isTimerEnabled,
        duration: this.duration,
        volume: this.volume,
        noiseColor: this.noiseColor,
        isFilterEnabled: this.isFilterEnabled,
        filterType: this.filterType,
        filterCutoff: this.filterCutoff,
        isLFOFilterCutoffEnabled: this.isLFOFilterCutoffEnabled,
        lfoFilterCutoffFrequency: this.lfoFilterCutoffFrequency,
        lfoFilterCutoffLow: this.lfoFilterCutoffRange[0],
        lfoFilterCutoffHigh: this.lfoFilterCutoffRange[1],
        isTremoloEnabled: this.isTremoloEnabled,
        tremoloFrequency: this.tremoloFrequency,
        tremoloDepth: this.tremoloDepth,
        samples: this.loadedSamples
      }).then(response => {
        if (response.status === 200) {
          this.unsavedWork = false
          this.infoSnackbarText = 'Profile Saved'
          this.infoSnackbar = true
        }
        return response
      })
        .catch(error => {
          this.errorSnackbarText = 'Error Saving Profile'
          this.errorSnackbar = true
          throw error
        })
    },
    loadProfile (checkForUnsavedWork) {
      // Switching profiles while recording would leave the recording graph
      // driven by settings that no longer match the UI. Refuse it explicitly.
      if (this.isRecording || this.recordingStarting || this.recordingFinishing) {
        this.errorSnackbarText = 'Stop recording before switching profiles'
        this.errorSnackbar = true
        this.selectedProfile = this.profileItems.find(p => p.id === this.activeProfile.id) || this.selectedProfile
        return
      }

      if (checkForUnsavedWork && this.unsavedWork) {
        this.confirmSwitchProfileDialog = true
      } else {
        this.$http.get('/profiles/'.concat(this.selectedProfile.id))
          .then(response => {
            if (response.status === 200) {
              const profile = response.data.profile

              this.isTimerEnabled = profile.isTimerEnabled
              this.duration = profile.duration
              this.volume = profile.volume
              this.noiseColor = profile.noiseColor
              this.isFilterEnabled = profile.isFilterEnabled
              this.filterType = profile.filterType
              this.filterCutoff = profile.filterCutoff
              this.isLFOFilterCutoffEnabled = profile.isLFOFilterCutoffEnabled
              this.lfoFilterCutoffFrequency = profile.lfoFilterCutoffFrequency
              this.lfoFilterCutoffRange[0] = profile.lfoFilterCutoffLow
              this.lfoFilterCutoffRange[1] = profile.lfoFilterCutoffHigh
              this.isTremoloEnabled = profile.isTremoloEnabled
              this.tremoloFrequency = profile.tremoloFrequency
              this.tremoloDepth = profile.tremoloDepth

              this.loadedSamples = profile.samples

              this.activeProfile = profile

              if (this.unwatch) {
                this.unwatch()
              }

              this.unwatch = this.$watch('changeableSettings', function () {
                this.unsavedWork = true
              })
            }
          })
          .catch(() => {
            this.errorSnackbarText = 'Error Loading Profile'
            this.errorSnackbar = true
          })
      }
    },
    deleteProfile () {
      this.$http.delete('/profiles/'.concat(this.selectedProfile.id))
        .then(response => {
          if (response.status === 200) {
            this.populateProfileItems(0)
            this.infoSnackbarText = 'Profile Deleted'
            this.infoSnackbar = true
          }
        })
        .catch(() => {
          this.errorSnackbarText = 'Error Deleting Profile'
          this.errorSnackbar = true
        })
    },
    getSamples () {
      this.$http.get('/samples')
        .then(response => {
          if (response.status === 200) {
            this.allSamples = response.data.samples
            this.allSamples.forEach(s => {
              if (!this.players.has(s.id)) {
                this.players.add(s.id, '/samples/' + s.user + '_' + s.name).toDestination()
              }
            })
            this.mainPlayLoading = false
          }
        })
    },
    uploadSample () {
      const formData = new FormData()

      formData.append('name', this.sampleName)
      formData.append('sample', this.selectedSample)

      this.$http.post('/samples', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
        .then(response => {
          if (response.status === 200) {
            this.getSamples()
            this.populatePreviewSampleItems()
            this.infoSnackbarText = 'Sample Uploaded'
            this.infoSnackbar = true
          }
        })
        .catch((error) => {
          if (error.response.status === 409) {
            this.errorSnackbarText = 'Error Uploading Sample: Duplicate Sample Name'
          } else {
            this.errorSnackbarText = 'Error Uploading Sample'
          }
          this.errorSnackbar = true
        })

      this.uploadSampleDialog = false
    },
    addSample () {
      this.checkedSamples.forEach(i => {
        const load = this.allSamples.find(e => e.id === i)
        load.volume = -10
        load.sporadicMin = 30
        load.sporadicMax = 300
        this.loadedSamples.push(load)
      })

      this.addSampleDialog = false
      this.checkedSamples = []
    },
    updateSampleVolume (id, index) {
      this.players.player(id).volume.value = this.loadedSamples[index].volume
      this.$forceUpdate()
    },
    removeSample (index) {
      this.loadedSamples.splice(index, 1)
    },
    getCurrentUser () {
      this.$http.get('/users/current')
        .then(response => {
          if (response.status === 200) {
            this.canUpload = response.data.user.canUpload
            this.$vuetify.theme.dark = response.data.user.darkMode
            const preferences = response.data.user.preferences
            this.$vuetify.theme.themes.dark.primary = preferences.accentColor.hex
            this.$vuetify.theme.themes.light.primary = preferences.accentColor.hex
          }
        })
    },
    resetProfileForm () {
      if (this.$refs.profileForm) {
        this.$refs.profileForm.reset()
      }
    },
    resetUploadSampleForm () {
      if (this.$refs.uploadSampleForm) {
        this.$refs.uploadSampleForm.reset()
      }
    },
    openImportDialog () {
      this.profileMoreDialog = false
      this.importDialog = true
    },
    openExportDialog () {
      this.profileMoreDialog = false
      this.exportDialog = true
    },
    async importProfile () {
      const fileContents = await this.readFile(this.importedProfile)
      const profileJSON = JSON.parse(fileContents)

      this.$http.post('/profiles/import', {
        name: this.importedProfileName,
        isTimerEnabled: profileJSON.isTimerEnabled,
        duration: profileJSON.duration,
        volume: profileJSON.volume,
        noiseColor: profileJSON.noiseColor,
        isFilterEnabled: profileJSON.isFilterEnabled,
        filterType: profileJSON.filterType,
        filterCutoff: profileJSON.filterCutoff,
        isLFOFilterCutoffEnabled: profileJSON.isLFOFilterCutoffEnabled,
        lfoFilterCutoffFrequency: profileJSON.lfoFilterCutoffFrequency,
        lfoFilterCutoffLow: profileJSON.lfoFilterCutoffLow,
        lfoFilterCutoffHigh: profileJSON.lfoFilterCutoffHigh,
        isTremoloEnabled: profileJSON.isTremoloEnabled,
        tremoloFrequency: profileJSON.tremoloFrequency,
        tremoloDepth: profileJSON.tremoloDepth
      }).then(response => {
        if (response.status === 200) {
          this.importDialog = false
          this.populateProfileItems(response.data.id)
          this.infoSnackbarText = 'Profile Imported and Saved'
          this.infoSnackbar = true
        }
      })
        .catch(() => {
          this.errorSnackbarText = 'Error Importing Profile'
          this.errorSnackbar = true
        })

      if (this.$refs.importForm) {
        this.$refs.importForm.reset()
      }
    },
    readFile (file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()

        reader.onload = res => {
          resolve(res.target.result)
        }
        reader.onerror = err => reject(err)

        reader.readAsText(file)
      })
    },
    exportProfile () {
      this.$http.get('/profiles/'.concat(this.exportedProfile.id))
        .then(response => {
          if (response.status === 200) {
            const profile = response.data.profile

            const profileJSON = {}
            profileJSON.name = this.exportedProfile.text
            profileJSON.isTimerEnabled = profile.isTimerEnabled
            profileJSON.duration = profile.duration
            profileJSON.volume = profile.volume
            profileJSON.noiseColor = profile.noiseColor
            profileJSON.isFilterEnabled = profile.isFilterEnabled
            profileJSON.filterType = profile.filterType
            profileJSON.filterCutoff = profile.filterCutoff
            profileJSON.isLFOFilterCutoffEnabled = profile.isLFOFilterCutoffEnabled
            profileJSON.lfoFilterCutoffFrequency = profile.lfoFilterCutoffFrequency
            profileJSON.lfoFilterCutoffLow = profile.lfoFilterCutoffLow
            profileJSON.lfoFilterCutoffHigh = profile.lfoFilterCutoffHigh
            profileJSON.isTremoloEnabled = profile.isTremoloEnabled
            profileJSON.tremoloFrequency = profile.tremoloFrequency
            profileJSON.tremoloDepth = profile.tremoloDepth

            const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(profileJSON))
            const downloadAnchorNode = document.createElement('a')
            downloadAnchorNode.setAttribute('href', dataStr)
            downloadAnchorNode.setAttribute('download', profileJSON.name + '.json')
            document.body.appendChild(downloadAnchorNode) // required for firefox
            downloadAnchorNode.click()
            downloadAnchorNode.remove()
          }
        })
        .catch(() => {
          this.errorSnackbarText = 'Error Exporting Profile'
          this.errorSnackbar = true
        })

      this.exportDialog = false
    },
    populatePreviewSampleItems () {
      this.$http.get('/samples')
        .then(response => {
          if (response.status === 200) {
            this.previewSampleItems = response.data.samples
            if (this.previewSampleItems.length > 0) {
              this.selectedPreviewSample = this.previewSampleItems[0]
            }
          }
        })
    },
    openEditSampleForm () {
      if (this.previewSampleItems.length > 0) {
        this.selectedPreviewSample = this.previewSampleItems[0]
      }
      this.loadPreviewSample()
    },
    closeEditSampleForm () {
      this.editSampleDialog = false
      this.previewSampleLoading = true
      if (this.previewSamplePlaying) {
        this.previewSamplePlaying = false
        this.previewSampleButtonText = 'Preview Sample'
        this.samplePreviewPlayer.stop()
      }
    },
    loadPreviewSample () {
      this.previewSampleLoading = true
      this.$http.get('/samples/'.concat(this.selectedPreviewSample.id))
        .then(async response => {
          if (response.status === 200) {
            const sample = response.data.sample

            await this.samplePreviewPlayer.load('/samples/' + sample.user + '_' + sample.name)

            this.previewSampleFadeIn = sample.fadeIn
            this.previewSampleLoopPointsEnabled = sample.loopPointsEnabled
            if (sample.loopPointsEnabled) {
              this.previewSampleLoopStart = sample.loopStart
              this.previewSampleLoopEnd = sample.loopEnd
              this.samplePreviewPlayer.setLoopPoints(this.previewSampleLoopStart, this.previewSampleLoopEnd)
            } else {
              this.previewSampleLoopStart = 0
              this.previewSampleLoopEnd = 0
            }
            this.samplePreviewPlayer.fadeIn = this.previewSampleFadeIn
            this.previewSampleLength = this.samplePreviewPlayer.buffer.duration
            this.previewSampleLoading = false
          }
        })
    },
    updatePreviewSampleLoopPoints () {
      if (this.previewSampleLoopPointsEnabled) {
        this.samplePreviewPlayer.setLoopPoints(this.previewSampleLoopStart, this.previewSampleLoopEnd)
      } else {
        this.samplePreviewPlayer.setLoopPoints(0, this.samplePreviewPlayer.buffer.duration)
      }
    },
    previewSample () {
      if (this.previewSamplePlaying) {
        this.previewSamplePlaying = false
        this.previewSampleButtonText = 'Preview Sample'
        this.samplePreviewPlayer.stop()
      } else {
        this.previewSamplePlaying = true
        this.previewSampleButtonText = 'Stop'
        this.samplePreviewPlayer.start()
      }
    },
    editSample () {
      this.$http.put('/samples/'.concat(this.selectedPreviewSample.id), {
        fadeIn: this.previewSampleFadeIn,
        loopPointsEnabled: this.previewSampleLoopPointsEnabled,
        loopStart: this.previewSampleLoopStart,
        loopEnd: this.previewSampleLoopEnd
      }).then(response => {
        if (response.status === 200) {
          this.getSamples()

          //  Update sample if it's already loaded in current profile
          const sample = this.loadedSamples.find(s => s.id === this.selectedPreviewSample.id)
          if (sample) {
            sample.fadeIn = this.previewSampleFadeIn
            sample.loopPointsEnabled = this.previewSampleLoopPointsEnabled
            sample.loopStart = this.previewSampleLoopStart
            sample.loopEnd = this.previewSampleLoopEnd
          }

          this.closeEditSampleForm()
          this.infoSnackbarText = 'Sample Saved'
          this.infoSnackbar = true
        }
      })
        .catch(() => {
          this.errorSnackbarText = 'Error Saving Sample'
          this.errorSnackbar = true
        })
    },
    updatePreviewSamplePlayerFadeIn () {
      this.samplePreviewPlayer.fadeIn = this.previewSampleFadeIn
    },
    updatePreviewSamplePlayerLoopPoints () {
      if (this.previewSampleLoopStart >= 0 && this.previewSampleLoopEnd <= this.previewSampleLength) {
        this.samplePreviewPlayer.setLoopPoints(this.previewSampleLoopStart, this.previewSampleLoopEnd)
      }
    },
    openStartRecordingDialog () {
      // A recording is already running: don't open a second entry point.
      if (this.isRecording || this.recordingStarting || this.recordingFinishing) {
        return
      }

      if (this.playDisabled) {
        this.stop()
      }

      this.startRecordingDialog = true
      this.profileMoreDialog = false
    },
    async startRecording () {
      if (this.isRecording || this.recordingStarting || this.recordingFinishing) {
        return
      }

      if (!Tone.Recorder.supported) {
        this.errorSnackbarText = 'Recording is not supported in this browser'
        this.errorSnackbar = true
        return
      }

      if (!this.players || !this.players.loaded) {
        return
      }

      this.recordingStarting = true

      const token = {}
      this.recordingStartToken = token
      const session = ++this.recordingSession

      try {
        // Save current profile before recording; the profile to record is then
        // loaded so the recorded audio matches what was saved.
        await this.updateProfile()

        const profile = await this.fetchProfile(this.recordedProfile.id)

        if (session !== this.recordingSession) {
          return
        }

        // Remember the profile the user is on so the recording session can
        // hand the UI and the audio graph back to it when it ends.
        this.preRecordingSettings = this.captureSettings()

        this.applyProfileToSettings(profile)

        await Tone.start()

        if (session !== this.recordingSession) {
          return
        }

        this.startRecordingDialog = false
        this.recordingDialog = true
        this.recordingTimeElapsed = 0

        this.playProfileForRecording()

        // Wait until the Transport is actually running before starting the
        // recorder so the first samples are captured. Bail out early if the
        // recording is cancelled while waiting.
        await new Promise(resolve => {
          if (Tone.Transport.state === 'started') {
            resolve()
            return
          }

          const check = setInterval(() => {
            if (session !== this.recordingSession || Tone.Transport.state === 'started') {
              clearInterval(check)
              resolve()
            }
          }, 10)
        })

        if (session !== this.recordingSession) {
          return
        }

        await this.recorder.start()

        if (session !== this.recordingSession) {
          return
        }

        this.isRecording = true
        this.recordingInterval = setInterval(() => this.recordingTimeElapsed++, 1000)
      } catch (e) {
        if (session === this.recordingSession) {
          await this.finishRecording(false)
          this.errorSnackbarText = 'Error Recording Profile'
          this.errorSnackbar = true
        }
      } finally {
        if (this.recordingStartToken === token) {
          this.recordingStartToken = null
          this.recordingStarting = false
        }
      }
    },
    playProfileForRecording () {
      // Recording uses the same graph builder as normal playback, but routed
      // through a record bus that feeds both the speakers and the recorder.
      this.stopPlayback()

      this.playDisabled = true
      this.playbackActive = true

      this.recorder = new Tone.Recorder()
      this.recordBus = new Tone.Gain(1)
      this.recordBus.connect(Tone.Destination)
      this.recordBus.connect(this.recorder)
      this.graphTarget = this.recordBus

      const samples = this.loadedSamples.slice()
      this.sessionSamples = samples
      this.activePlayerIds = samples.map(s => s.id)

      this.createSourceChain(this.recordBus)
      this.noise.sync().start(0)

      samples.forEach(s => this.routeSample(s, this.recordBus))
      this.scheduleSamples(samples, false)

      Tone.Transport.start('+0.1')
    },
    async fetchProfile (profileId) {
      const response = await this.$http.get('/profiles/'.concat(profileId))

      if (response.status !== 200) {
        throw new Error('Error loading profile for recording')
      }

      return response.data.profile
    },
    applyProfileToSettings (profile) {
      this.isTimerEnabled = profile.isTimerEnabled
      this.duration = profile.duration
      this.volume = profile.volume
      this.noiseColor = profile.noiseColor
      this.isFilterEnabled = profile.isFilterEnabled
      this.filterType = profile.filterType
      this.filterCutoff = profile.filterCutoff
      this.isLFOFilterCutoffEnabled = profile.isLFOFilterCutoffEnabled
      this.lfoFilterCutoffFrequency = profile.lfoFilterCutoffFrequency
      this.lfoFilterCutoffRange[0] = profile.lfoFilterCutoffLow
      this.lfoFilterCutoffRange[1] = profile.lfoFilterCutoffHigh
      this.isTremoloEnabled = profile.isTremoloEnabled
      this.tremoloFrequency = profile.tremoloFrequency
      this.tremoloDepth = profile.tremoloDepth

      this.loadedSamples = profile.samples
    },
    async stopRecording () {
      await this.finishRecording(true)
    },
    async cancelRecording () {
      await this.finishRecording(false)
    },
    async finishRecording (download) {
      if (this.recordingFinishing) {
        return
      }

      // Invalidate any in-flight startRecording chain and take ownership of
      // the teardown so the two paths can never tear down twice.
      this.recordingSession++
      this.recordingFinishing = true
      this.recordingStarting = false
      this.isRecording = false

      clearInterval(this.recordingInterval)
      this.recordingInterval = null

      const recorder = this.recorder
      let recording = null

      try {
        if (recorder && recorder.state !== 'stopped') {
          recording = await recorder.stop()
        }
      } catch (e) {
        recording = null
      }

      // Everything built for the recording (source chain, per-sample reverbs,
      // record bus, recorder and its connections) is torn down before the
      // normal playback graph is restored.
      this.stopPlayback()
      this.graphTarget = null

      this.recordingDialog = false
      this.recordingTimeElapsed = 0

      // Hand the UI and the (now torn-down) audio graph back to the profile
      // the user was on before recording; the next playback rebuilds the
      // normal graph from these settings.
      this.restorePreRecordingState()

      if (download && recording) {
        const url = URL.createObjectURL(recording)
        const anchor = document.createElement('a')
        anchor.download = this.recordingFileName + '.webm'
        anchor.href = url
        anchor.click()

        // Release the blob URL once the download has been triggered.
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }

      this.recordingFinishing = false
    },
    captureSettings () {
      return {
        isTimerEnabled: this.isTimerEnabled,
        duration: this.duration,
        volume: this.volume,
        noiseColor: this.noiseColor,
        isFilterEnabled: this.isFilterEnabled,
        filterType: this.filterType,
        filterCutoff: this.filterCutoff,
        isLFOFilterCutoffEnabled: this.isLFOFilterCutoffEnabled,
        lfoFilterCutoffFrequency: this.lfoFilterCutoffFrequency,
        lfoFilterCutoffRange: [this.lfoFilterCutoffRange[0], this.lfoFilterCutoffRange[1]],
        isTremoloEnabled: this.isTremoloEnabled,
        tremoloFrequency: this.tremoloFrequency,
        tremoloDepth: this.tremoloDepth,
        loadedSamples: this.loadedSamples.slice()
      }
    },
    restorePreRecordingState () {
      const settings = this.preRecordingSettings
      this.preRecordingSettings = null

      if (!settings) {
        // The start chain failed before a snapshot was taken; re-read the
        // selected profile instead.
        this.restoreSelectedProfile()
        return
      }

      this.isTimerEnabled = settings.isTimerEnabled
      this.duration = settings.duration
      this.volume = settings.volume
      this.noiseColor = settings.noiseColor
      this.isFilterEnabled = settings.isFilterEnabled
      this.filterType = settings.filterType
      this.filterCutoff = settings.filterCutoff
      this.isLFOFilterCutoffEnabled = settings.isLFOFilterCutoffEnabled
      this.lfoFilterCutoffFrequency = settings.lfoFilterCutoffFrequency
      this.lfoFilterCutoffRange = settings.lfoFilterCutoffRange
      this.isTremoloEnabled = settings.isTremoloEnabled
      this.tremoloFrequency = settings.tremoloFrequency
      this.tremoloDepth = settings.tremoloDepth
      this.loadedSamples = settings.loadedSamples

      // These settings match the selected profile again (it was saved before
      // recording started), so there is no unsaved work to prompt about. The
      // change watcher fires on the next tick, so clear the flag after it.
      this.clearUnsavedWorkAfterWatcher()
    },
    clearUnsavedWorkAfterWatcher () {
      if (typeof this.$nextTick === 'function') {
        this.$nextTick(() => { this.unsavedWork = false })
      } else {
        this.unsavedWork = false
      }
    },
    restoreSelectedProfile () {
      if (!this.selectedProfile || this.selectedProfile.id === undefined) {
        return
      }

      this.$http.get('/profiles/'.concat(this.selectedProfile.id))
        .then(response => {
          if (response.status === 200) {
            this.applyProfileToSettings(response.data.profile)
            this.unsavedWork = false
          }
        })
        .catch(() => {
          this.errorSnackbarText = 'Error Loading Profile'
          this.errorSnackbar = true
        })
    },
    discardChanges () {
      this.unsavedWork = false
      this.loadProfile(true)
      this.confirmSwitchProfileDialog = false
    },
    saveChanges () {
      // Set active profile back to previously selected one before saving
      this.selectedProfile = this.profileItems.find(p => p.text === this.activeProfile.name)
      this.updateProfile()
      this.confirmSwitchProfileDialog = false
    }
  }
}
