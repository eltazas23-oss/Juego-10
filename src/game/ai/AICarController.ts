/**
 * AICarController.ts - Professional Multi-Car AI Racing Pilot
 * Controls autonomous F1 cars with dynamic racing lines, realistic tire wear,
 * multi-compound pit stop strategies, slipstream overtaking, and collision avoidance.
 */

import * as THREE from 'three';
import { CarModel } from '../models/CarModel';
import { TeamLiveryConfig, RaceDifficulty, DriverLeaderboardEntry } from '../career/CareerTypes';
import { TireCompoundType, TIRE_COMPOUNDS } from '../physics/TireCompound';
import { ParticleSystem } from '../particles/ParticleSystem';
import { DamageState } from '../physics/VehiclePhysics';

export interface SplinePoint {
  x: number;
  z: number;
  speedLimitKmh: number; // Maximum target speed through this waypoint
  yaw: number;
}

export class AICarController {
  public team: TeamLiveryConfig;
  public carModel: CarModel;
  public difficulty: RaceDifficulty;

  // Track position & physics simulation
  public distanceAlongTrack: number = 0; // 0 to TrackLength
  public trackProgressNormalized: number = 0; // 0.0 to 1.0 per lap
  public currentLap: number = 1;
  public currentSector: number = 0;
  public speedKmh: number = 0;
  public speedMs: number = 0;
  public lateralOffset: number = 0; // Offset from optimal racing line (-4.0 to +4.0)
  public targetLateralOffset: number = 0;
  public position = new THREE.Vector3();
  public yaw: number = 0;
  public steerAngle: number = 0;
  public brakeInput: number = 0;
  public throttleInput: number = 0;
  public slipRatio: number = 0;
  public rpm: number = 4000;
  public gear: number = 1;

  // Wheel rotations
  private wheelSpin: number = 0;

  // Tire Compound & Degradation
  public currentCompound: TireCompoundType = 'medium';
  public nextPitCompound: TireCompoundType = 'hard';
  public tireWear: [number, number, number, number] = [0, 0, 0, 0]; // 0% to 100%
  public compoundsUsed: Set<TireCompoundType> = new Set();
  public pitStopsCount: number = 0;

  // Pit Stop State
  public isInPitLane: boolean = false;
  public isStationaryInBox: boolean = false;
  public pitProgress: number = 0;
  public pitTimer: number = 0;
  public readonly pitDuration: number = 5.2; // Calibrated identical to player
  public plannedPitLaps: number[] = [];
  public hasPlannedStops: boolean = false;

  // Timing & Telemetry
  public currentLapTime: number = 0;
  public lastLapTime: number | null = null;
  public bestLapTime: number | null = null;
  public totalRaceTime: number = 0;
  public isFinished: boolean = false;
  public finishTime: number = 0;

  // Track geometry metrics
  private readonly totalTrackLength = 974.76;
  private waypoints: SplinePoint[] = [];

  constructor(
    team: TeamLiveryConfig,
    difficulty: RaceDifficulty = 'medium',
    startingCompound: TireCompoundType = 'medium',
    totalRaceLaps: number = 20
  ) {
    this.team = team;
    this.difficulty = difficulty;
    this.currentCompound = startingCompound;
    this.compoundsUsed.add(startingCompound);
    this.carModel = new CarModel(team);
    this.carModel.setTireCompoundVisuals(startingCompound);

    this.buildTrackWaypoints();
    this.planPitStrategy(totalRaceLaps);
  }

  /**
   * Pre-generates the closed racing line waypoints for the square circuit with rounded corners
   */
  private buildTrackWaypoints(): void {
    const points: { x: number; z: number; speed: number }[] = [];
    const r = 38;
    const inner = 92;

    // Main Straight: top edge (z = -130, x from -92 to +92)
    const numStraight = 18;
    for (let i = 0; i <= numStraight; i++) {
      const t = i / numStraight;
      points.push({ x: -inner + t * (2 * inner), z: -130, speed: 335 });
    }

    // Turn 1 (Top-Right): arc from (92, -130) to (130, -92) around center (92, -92)
    const numCorner = 12;
    for (let i = 1; i <= numCorner; i++) {
      const angle = -Math.PI / 2 + (i / numCorner) * (Math.PI / 2);
      points.push({
        x: inner + Math.cos(angle) * r,
        z: -inner + Math.sin(angle) * r,
        speed: 130,
      });
    }

    // Straight 1 (Right edge): x = 130, z from -92 to +92
    for (let i = 1; i <= numStraight; i++) {
      const t = i / numStraight;
      points.push({ x: 130, z: -inner + t * (2 * inner), speed: 330 });
    }

    // Turn 2 (Bottom-Right): arc from (130, 92) to (92, 130) around center (92, 92)
    for (let i = 1; i <= numCorner; i++) {
      const angle = 0 + (i / numCorner) * (Math.PI / 2);
      points.push({
        x: inner + Math.cos(angle) * r,
        z: inner + Math.sin(angle) * r,
        speed: 130,
      });
    }

    // Straight 2 (Bottom edge): z = 130, x from +92 to -92
    for (let i = 1; i <= numStraight; i++) {
      const t = i / numStraight;
      points.push({ x: inner - t * (2 * inner), z: 130, speed: 330 });
    }

    // Turn 3 (Bottom-Left): arc from (-92, 130) to (-130, 92) around center (-92, 92)
    for (let i = 1; i <= numCorner; i++) {
      const angle = Math.PI / 2 + (i / numCorner) * (Math.PI / 2);
      points.push({
        x: -inner + Math.cos(angle) * r,
        z: inner + Math.sin(angle) * r,
        speed: 130,
      });
    }

    // Straight 3 (Left edge): x = -130, z from +92 to -92
    for (let i = 1; i <= numStraight; i++) {
      const t = i / numStraight;
      points.push({ x: -130, z: inner - t * (2 * inner), speed: 335 });
    }

    // Turn 4 (Top-Left): arc from (-130, -92) to (-92, -130) around center (-92, -92)
    for (let i = 1; i < numCorner; i++) {
      const angle = Math.PI + (i / numCorner) * (Math.PI / 2);
      points.push({
        x: -inner + Math.cos(angle) * r,
        z: -inner + Math.sin(angle) * r,
        speed: 130,
      });
    }

    // Compute tangents & yaw
    this.waypoints = points.map((pt, idx, arr) => {
      const next = arr[(idx + 1) % arr.length];
      const dx = next.x - pt.x;
      const dz = next.z - pt.z;
      const yaw = Math.atan2(dx, dz);
      return {
        x: pt.x,
        z: pt.z,
        speedLimitKmh: pt.speed,
        yaw: yaw,
      };
    });
  }

  /**
   * Plans realistic AI pit stop strategy based on race length and compound rules
   */
  public planPitStrategy(totalLaps: number): void {
    this.hasPlannedStops = true;
    if (totalLaps === 9) {
      // Sprint race: if starting on Soft, 1 stop at lap 4-5 to Softs/Mediums. If starting Medium/Hard, 0 stops.
      if (this.currentCompound === 'soft') {
        this.plannedPitLaps = [4];
        this.nextPitCompound = 'medium';
      } else {
        this.plannedPitLaps = [];
      }
    } else if (totalLaps === 20) {
      // 20-Lap GP: Mandatory 2 compounds!
      const pitLap = 8 + Math.floor(Math.random() * 4); // Laps 8 to 11
      this.plannedPitLaps = [pitLap];
      // Pick a distinct compound to satisfy the 2-compound rule
      if (this.currentCompound === 'soft') {
        this.nextPitCompound = 'medium';
      } else if (this.currentCompound === 'medium') {
        this.nextPitCompound = 'hard';
      } else {
        this.nextPitCompound = 'soft';
      }
    } else {
      // 50-Lap Endurance GP: 2 stops (e.g. Lap 16 and Lap 33)
      this.plannedPitLaps = [16, 33];
      this.nextPitCompound = this.currentCompound === 'soft' ? 'medium' : 'hard';
    }
  }

  public setGridPosition(gridSlot: number): void {
    // Staggered starting grid along main straight (z around -130, x around -35)
    // Slot 1: x = -34, z = -126
    // Slot 2: x = -38, z = -134
    // Slot 3: x = -34, z = -142
    // Slot 4: x = -38, z = -150
    // Slot 5: x = -34, z = -158
    const isLeft = gridSlot % 2 === 1;
    const gridZ = -126 - (gridSlot - 1) * 8.0;
    const gridX = isLeft ? -34.0 : -38.0;

    this.position.set(gridX, 0.35, gridZ);
    this.yaw = Math.PI / 2; // Facing positive X down the main straight
    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, this.yaw, 0);

    // Synchronize distanceAlongTrack with starting grid position
    // Main straight has z = -130, x from -92 to 92
    const startProgressX = gridX - (-92);
    this.distanceAlongTrack = Math.max(0, startProgressX);
    this.trackProgressNormalized = this.distanceAlongTrack / this.totalTrackLength;
    this.speedKmh = 0;
    this.speedMs = 0;
  }

  /**
   * Main AI Update Loop: Trajectory following, tire wear, overtaking, pit stops
   */
  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerSpeedKmh: number,
    otherAiCars: AICarController[],
    particles: ParticleSystem,
    isRaceActive: boolean
  ): void {
    if (!isRaceActive) {
      // Controls locked on grid
      this.speedKmh = 0;
      this.speedMs = 0;
      this.carModel.group.position.copy(this.position);
      this.carModel.group.rotation.set(0, this.yaw, 0);
      return;
    }

    if (this.isFinished) {
      // Slow down after finish line
      this.speedKmh = Math.max(50, this.speedKmh - 40 * dt);
      this.speedMs = this.speedKmh / 3.6;
    }

    // 1. Pit Stop Handling
    if (this.isInPitLane) {
      this.updatePitLane(dt, particles);
      return;
    }

    // Check if AI needs to pit this lap
    const needsPit =
      this.plannedPitLaps.includes(this.currentLap) ||
      (this.tireWear[0] > 80 && this.pitStopsCount < 2);

    // Pit entry zone is near the end of Turn 4 (x around -80 to -50, z around -125 to -115)
    if (needsPit && this.position.x > -85 && this.position.x < -45 && this.position.z < -110 && !this.isInPitLane) {
      this.isInPitLane = true;
      this.isStationaryInBox = false;
      this.pitTimer = 0;
      this.plannedPitLaps = this.plannedPitLaps.filter((l) => l !== this.currentLap);
    }

    // 2. Compute Track Position along Waypoint Spline
    const numPts = this.waypoints.length;
    const progressIndex = Math.floor((this.trackProgressNormalized * numPts) % numPts);
    const nextIndex = (progressIndex + 1) % numPts;
    const currPt = this.waypoints[progressIndex];
    const nextPt = this.waypoints[nextIndex];

    // Difficulty Speed Modifiers
    const diffSpeedScale = {
      easy: 0.84,    // Relaxed rookie pace
      medium: 0.93,  // Competitive pro pace
      hard: 0.99,    // Blistering F1 Elite pace
    }[this.difficulty];

    const compoundConfig = TIRE_COMPOUNDS[this.currentCompound] || TIRE_COMPOUNDS.soft;
    const gripFactor = compoundConfig.gripMultiplier * (1.0 - Math.min(0.35, (this.tireWear[0] / 100) * 0.40));

    // Target Speed for current segment
    const targetSpeedKmh = currPt.speedLimitKmh * diffSpeedScale * gripFactor;

    // Smooth Acceleration and Braking
    if (this.speedKmh < targetSpeedKmh) {
      const accelRate = 42.0 * diffSpeedScale;
      this.speedKmh = Math.min(targetSpeedKmh, this.speedKmh + accelRate * dt);
      this.throttleInput = 1.0;
      this.brakeInput = 0.0;
    } else {
      const brakeRate = 85.0;
      this.speedKmh = Math.max(targetSpeedKmh, this.speedKmh - brakeRate * dt);
      this.throttleInput = 0.0;
      this.brakeInput = 0.8;
    }

    this.speedMs = this.speedKmh / 3.6;

    // 3. Collision Avoidance & Slipstream Overtaking
    this.targetLateralOffset = 0;
    const myPos = this.position;

    // Check distance to player
    const distToPlayer = myPos.distanceTo(playerPos);
    if (distToPlayer < 18.0) {
      // If close to player, pull to the inside/outside to overtake or avoid collision
      const toPlayer = new THREE.Vector3().subVectors(playerPos, myPos);
      const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const dot = forward.dot(toPlayer.normalize());
      if (dot > 0.65) {
        // Player is directly ahead! Offset laterally to pass
        this.targetLateralOffset = playerPos.x > myPos.x ? -2.8 : 2.8;
        if (distToPlayer < 7.0 && this.speedKmh > playerSpeedKmh) {
          // Moderate braking to prevent rear-ending
          this.speedKmh = Math.max(playerSpeedKmh * 0.96, this.speedKmh - 50 * dt);
          this.speedMs = this.speedKmh / 3.6;
        }
      }
    }

    // Check distance to other AI cars
    for (const other of otherAiCars) {
      if (other === this) continue;
      const dist = myPos.distanceTo(other.position);
      if (dist < 12.0) {
        const toOther = new THREE.Vector3().subVectors(other.position, myPos);
        const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        if (forward.dot(toOther.normalize()) > 0.6) {
          this.targetLateralOffset = other.position.x > myPos.x ? -2.4 : 2.4;
        }
      }
    }

    // Smooth lateral movement
    this.lateralOffset += (this.targetLateralOffset - this.lateralOffset) * Math.min(1.0, 4.0 * dt);

    // 4. Update Position & Heading
    this.distanceAlongTrack = (this.distanceAlongTrack + this.speedMs * dt) % this.totalTrackLength;
    this.trackProgressNormalized = this.distanceAlongTrack / this.totalTrackLength;

    // Interpolate world position
    const tSeg = (this.trackProgressNormalized * numPts) % 1;
    const baseWorldX = THREE.MathUtils.lerp(currPt.x, nextPt.x, tSeg);
    const baseWorldZ = THREE.MathUtils.lerp(currPt.z, nextPt.z, tSeg);

    // Normal vector perpendicular to trajectory for lateral offset
    const dx = nextPt.x - currPt.x;
    const dz = nextPt.z - currPt.z;
    const len = Math.hypot(dx, dz) || 1;
    const normX = -dz / len;
    const normZ = dx / len;

    this.position.x = baseWorldX + normX * this.lateralOffset;
    this.position.y = 0.35;
    this.position.z = baseWorldZ + normZ * this.lateralOffset;

    // Smooth Yaw
    const targetYaw = Math.atan2(dx, dz);
    let diffYaw = targetYaw - this.yaw;
    while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
    while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
    this.yaw += diffYaw * Math.min(1.0, 14.0 * dt);

    this.steerAngle = THREE.MathUtils.clamp(diffYaw * 1.5, -0.45, 0.45);

    // 5. Tire Wear Degradation
    const wearRate = compoundConfig.wearRateMultiplier * (this.speedMs * 0.00016) * dt;
    for (let i = 0; i < 4; i++) {
      this.tireWear[i] = Math.min(100, this.tireWear[i] + wearRate);
    }

    // 6. Timing & Sector Tracking
    this.currentLapTime += dt;
    this.totalRaceTime += dt;

    if (this.currentSector === 0 && this.position.x > 40 && this.position.z < -50) {
      this.currentSector = 1;
    } else if (this.currentSector === 1 && this.position.x > 50 && this.position.z > 40) {
      this.currentSector = 2;
    } else if (this.currentSector === 2 && this.position.x < -40 && this.position.z > 50) {
      this.currentSector = 3;
    } else if (this.currentSector === 3 && this.position.x < -50 && this.position.z < -40) {
      this.currentSector = 4;
    } else if (this.currentSector === 4 && this.position.z < -115 && this.position.x >= -20 && this.position.x <= 20) {
      // Completed Lap!
      this.lastLapTime = this.currentLapTime;
      if (!this.bestLapTime || this.currentLapTime < this.bestLapTime) {
        this.bestLapTime = this.currentLapTime;
      }
      this.currentLap++;
      this.currentLapTime = 0;
      this.currentSector = 0;
    }

    // 7. Update 3D Model Visuals
    this.wheelSpin += (this.speedMs / 0.35) * dt;
    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, this.yaw, 0);

    const dummyDamage: DamageState = {
      overallHealth: 100,
      engineHealth: 100,
      suspensionLeft: 100,
      suspensionRight: 100,
      frontCrumple: 0,
      rearCrumple: 0,
      wingLoose: false,
      isTotaled: false,
    };

    this.carModel.update(
      this.steerAngle,
      [this.wheelSpin, this.wheelSpin, this.wheelSpin, this.wheelSpin],
      this.brakeInput,
      this.speedKmh,
      dummyDamage,
      false,
      Math.min(9500, Math.max(1000, 1500 + this.speedKmh * 24))
    );
  }

  /**
   * Dedicated Pit Lane Trajectory & Timed Mechanical Pit Stop Service
   */
  private updatePitLane(dt: number, particles: ParticleSystem): void {
    const targetStallZ = this.team.pitStallZ;
    const pitLaneX = 0; // Center of pit lane

    if (!this.isStationaryInBox) {
      // Driving down pit lane at 60 km/h pit limiter
      this.speedKmh = 60.0;
      this.speedMs = 60.0 / 3.6;

      this.position.x += (pitLaneX - this.position.x) * Math.min(1.0, 5.0 * dt);
      this.position.z += -this.speedMs * dt; // Moving in negative Z along pit lane
      this.yaw = Math.PI; // Heading along -Z

      // Check if arrived at its assigned team stall
      if (Math.abs(this.position.z - targetStallZ) < 1.2) {
        this.position.z = targetStallZ;
        this.position.x = pitLaneX;
        this.isStationaryInBox = true;
        this.pitTimer = 0;
        this.speedKmh = 0;
        this.speedMs = 0;
      }
    } else {
      // In box: stationary executing 4-wheel tire replacement
      this.speedKmh = 0;
      this.speedMs = 0;
      this.pitTimer += dt;
      this.pitProgress = Math.min(1.0, this.pitTimer / this.pitDuration);

      // Halfway through stop, mount fresh new compound!
      if (this.pitTimer >= this.pitDuration * 0.5 && this.currentCompound !== this.nextPitCompound) {
        this.currentCompound = this.nextPitCompound;
        this.compoundsUsed.add(this.currentCompound);
        this.carModel.setTireCompoundVisuals(this.currentCompound);
        // Reset tire wear
        this.tireWear = [0, 0, 0, 0];
      }

      // Finish pit stop service
      if (this.pitTimer >= this.pitDuration) {
        this.isStationaryInBox = false;
        this.isInPitLane = false;
        this.pitStopsCount++;

        // Rejoin main straight (z around -110 to -90, x around -35)
        this.position.set(-35.0, 0.35, -115.0);
        this.yaw = Math.PI / 2;
        this.distanceAlongTrack = 55.0; // Straight progress
        this.speedKmh = 75.0;

        // Smoke puff launch
        particles.emitTireSmoke(this.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 6, 0.85);
      }
    }

    this.carModel.group.position.copy(this.position);
    this.carModel.group.rotation.set(0, this.yaw, 0);
  }

  /**
   * Exports live data for F1 leaderboard
   */
  public getLeaderboardData(position: number, leaderDistance: number): DriverLeaderboardEntry {
    const avgWear = (this.tireWear[0] + this.tireWear[1] + this.tireWear[2] + this.tireWear[3]) / 4;
    const distanceDelta = leaderDistance - (this.currentLap * this.totalTrackLength + this.distanceAlongTrack);
    const gapSeconds = Math.max(0, distanceDelta / (this.speedMs || 50));

    return {
      id: this.team.id,
      position,
      driverCode: this.team.driverCode,
      driverName: this.team.driverName,
      driverNumber: this.team.driverNumber,
      teamName: this.team.teamName,
      teamColorCss: this.team.teamColorCss,
      currentLap: this.currentLap,
      currentSector: this.currentSector,
      currentCompound: this.currentCompound,
      compoundsUsed: Array.from(this.compoundsUsed),
      hasSatisfiedTireRule: this.compoundsUsed.size >= 2,
      tireWearAvg: avgWear,
      pitStopsCount: this.pitStopsCount,
      isInPit: this.isInPitLane,
      gapToLeaderFormatted: position === 1 ? 'LEADER' : `+${gapSeconds.toFixed(1)}s`,
      gapToAheadFormatted: position === 1 ? '-' : `+${(gapSeconds * 0.45).toFixed(1)}s`,
      lastLapTime: this.lastLapTime,
      bestLapTime: this.bestLapTime,
      currentLapTime: this.currentLapTime,
      totalRaceTime: this.totalRaceTime,
      isPlayer: false,
      isFinished: this.isFinished,
      hasPenalty: false,
      penaltySeconds: 0,
    };
  }
}
