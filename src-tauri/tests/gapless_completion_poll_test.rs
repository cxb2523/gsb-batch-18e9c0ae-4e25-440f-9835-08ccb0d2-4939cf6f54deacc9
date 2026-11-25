//! Exactly-once completion counting under the real polling-thread call order.
//!
//! `src/lib.rs` runs, every 250ms:
//! ```ignore
//! let transitioned = player.check_gapless_transition();
//! let ended = player.has_track_ended();
//! if ended { player.acknowledge_track_ended(); }
//! ```
//! The unit tests in `audio_test.rs` assert each state transition in
//! isolation; these cases drive that combined cycle repeatedly so a completion
//! can never be recorded twice across successive polls (replacement, clear and
//! gapless transition paths).

mod common;

use std::time::{Duration, Instant};

use lyra_music_lib::audio::AudioPlayer;

/// One iteration of the app polling thread's player lock section.
/// Returns whether a gapless transition was observed this cycle.
fn poll_like_app(player: &mut AudioPlayer) -> bool {
    let transitioned = player.check_gapless_transition();
    if player.has_track_ended() {
        player.acknowledge_track_ended();
    }
    transitioned
}

/// Run poll cycles until `predicate` is true or the deadline expires.
fn wait_until<F>(player: &mut AudioPlayer, timeout: Duration, mut predicate: F) -> bool
where
    F: FnMut(&AudioPlayer) -> bool,
{
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if predicate(player) {
            return true;
        }
        poll_like_app(player);
        std::thread::sleep(Duration::from_millis(25));
    }
    predicate(player)
}

/// Replacement path: B is queued then replaced by C. Only A's completion may
/// be recorded when A transitions straight to C; repeated later polls while C
/// plays must not add anything.
#[test]
#[cfg_attr(not(feature = "audio-tests"), ignore)]
fn test_replacement_poll_loop_counts_outgoing_track_once() {
    let dir = tempfile::tempdir().unwrap();
    let a = common::create_test_wav_with_samples(dir.path(), "repl_a.wav", 44100 / 2);
    let b = common::create_test_wav_with_samples(dir.path(), "repl_b.wav", 44100 * 5);
    let c = common::create_test_wav_with_samples(dir.path(), "repl_c.wav", 44100 * 5);

    let mut player = AudioPlayer::new().expect("need audio device");
    player.load_and_play(a.to_str().unwrap(), 0.5).unwrap();
    player.set_current_track_id(Some(1));
    player.queue_next(b.to_str().unwrap(), 2, 5.0).unwrap();
    player.queue_next(c.to_str().unwrap(), 3, 5.0).unwrap();

    assert!(
        wait_until(&mut player, Duration::from_secs(5), |p| p
            .get_current_track_id()
            == Some(3)),
        "replacement track C should become current"
    );
    assert_eq!(player.completion_seq(), 1);
    assert_eq!(player.last_completed_track_id(), Some(1));

    // Keep polling through C playback: no second completion may appear.
    for _ in 0..20 {
        poll_like_app(&mut player);
        std::thread::sleep(Duration::from_millis(25));
        assert_eq!(
            player.completion_seq(),
            1,
            "completion counted twice after replacement"
        );
    }
    assert_eq!(player.last_completed_track_id(), Some(1));
    assert_eq!(player.get_current_track_id(), Some(3));
}

/// Clear path: after clear_queued_next the current track ends on its own. Its
/// natural end is acknowledged exactly once.
#[test]
#[cfg_attr(not(feature = "audio-tests"), ignore)]
fn test_clear_poll_loop_counts_current_track_once() {
    let dir = tempfile::tempdir().unwrap();
    let a = common::create_test_wav_with_samples(dir.path(), "clear_seq_a.wav", 44100 / 2);
    let b = common::create_test_wav_with_samples(dir.path(), "clear_seq_b.wav", 44100 * 5);

    let mut player = AudioPlayer::new().expect("need audio device");
    player.load_and_play(a.to_str().unwrap(), 0.5).unwrap();
    player.set_current_track_id(Some(7));
    player.queue_next(b.to_str().unwrap(), 8, 5.0).unwrap();
    player.clear_queued_next();

    assert!(
        wait_until(&mut player, Duration::from_secs(5), |p| p.completion_seq()
            == 1),
        "the current track's natural end must be credited once after clear"
    );
    assert_eq!(player.last_completed_track_id(), Some(7));
    assert!(!player.is_gapless_queued());

    for _ in 0..20 {
        poll_like_app(&mut player);
        std::thread::sleep(Duration::from_millis(25));
        assert_eq!(
            player.completion_seq(),
            1,
            "acknowledged end re-armed on a later poll"
        );
    }
    assert_eq!(player.last_completed_track_id(), Some(7));
}

/// Transition path: after check_gapless_transition records the outgoing track,
/// further transition checks and poll cycles are sequence-neutral while the
/// incoming track keeps playing.
#[test]
#[cfg_attr(not(feature = "audio-tests"), ignore)]
fn test_transition_completion_not_duplicated_by_later_polls() {
    let dir = tempfile::tempdir().unwrap();
    let a = common::create_test_wav_with_samples(dir.path(), "trans_a.wav", 44100 / 10);
    let b = common::create_test_wav_with_samples(dir.path(), "trans_b.wav", 44100 * 5);

    let mut player = AudioPlayer::new().expect("need audio device");
    player.load_and_play(a.to_str().unwrap(), 0.1).unwrap();
    player.set_current_track_id(Some(11));
    player.queue_next(b.to_str().unwrap(), 12, 5.0).unwrap();

    assert!(
        wait_until(&mut player, Duration::from_secs(5), |p| {
            // wait_until's own poll performs the transition; observe it via id.
            p.get_current_track_id() == Some(12)
        }),
        "gapless transition should land on B"
    );

    // Direct repeat calls must be no-ops now that gapless_queued is false.
    for _ in 0..5 {
        assert!(!player.check_gapless_transition());
    }
    assert_eq!(player.completion_seq(), 1);
    assert_eq!(player.last_completed_track_id(), Some(11));

    // Continued polling while B plays adds no further completion.
    for _ in 0..20 {
        assert!(!poll_like_app(&mut player));
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(player.completion_seq(), 1);
    assert_eq!(player.last_completed_track_id(), Some(11));
    assert_eq!(player.get_current_track_id(), Some(12));
}

/// Full lifecycle through the poll order: A transitions gaplessly into B and B
/// then ends naturally. Each natural completion is counted exactly once and the
/// sequence never advances again after B is acknowledged.
#[test]
#[cfg_attr(not(feature = "audio-tests"), ignore)]
fn test_poll_loop_counts_transition_and_following_end_once_each() {
    let dir = tempfile::tempdir().unwrap();
    // A is short so the transition fires quickly; B is ~1s so the transition
    // is always observed before B ends.
    let a = common::create_test_wav_with_samples(dir.path(), "lifecycle_a.wav", 44100 / 10);
    let b = common::create_test_wav_with_samples(dir.path(), "lifecycle_b.wav", 44100);

    let mut player = AudioPlayer::new().expect("need audio device");
    player.load_and_play(a.to_str().unwrap(), 0.1).unwrap();
    player.set_current_track_id(Some(21));
    player.queue_next(b.to_str().unwrap(), 22, 1.0).unwrap();

    assert!(
        wait_until(&mut player, Duration::from_secs(8), |p| p.completion_seq()
            == 2),
        "expected one completion for A (transition) and one for B (natural end)"
    );
    assert_eq!(player.last_completed_track_id(), Some(22));

    // Drain any remaining poll cycles: the acknowledged B must not refire.
    for _ in 0..20 {
        poll_like_app(&mut player);
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(
        player.completion_seq(),
        2,
        "a completion was duplicated after acknowledgement"
    );
    assert_eq!(player.last_completed_track_id(), Some(22));
}
